'use strict';

const pubsub = require('pubsub-js');
const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('../../../data-access-layer/eventmesh');
const CONST = require('../../../common/constants');
const logger = require('../../../common/logger');
const lockManager = eventmesh.lockManager;
const errors = require('../../../common/errors');
const NotFound = errors.NotFound;

class UnlockResourcePoller {
  static start() {
    function poller(object, intervalId) {
      //TODO-PR - instead of a poller, its better to convert this to a watcher.
      const lockDetails = JSON.parse(object.spec.options);
      return eventmesh.apiServerClient.getResourceState({
          resourceGroup: lockDetails.lockedResourceDetails.resourceGroup,
          resourceType: lockDetails.lockedResourceDetails.resourceType,
          resourceId: lockDetails.lockedResourceDetails.resourceId
        })
        .then((resourceState) => {
          logger.debug(`[Unlock Poller] Got resource ${lockDetails.lockedResourceDetails.resourceId} state of ${lockDetails.lockedResourceDetails.operation}` +
            ` operation for deployment ${object.metadata.name} as`, resourceState);
          //TODO-PR - reuse util method is operationCompleted.
          if (_.includes([
              CONST.APISERVER.RESOURCE_STATE.SUCCEEDED,
              CONST.APISERVER.RESOURCE_STATE.FAILED,
              CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED,
              CONST.APISERVER.RESOURCE_STATE.ABORTED
            ], resourceState)) {
            return lockManager.unlock(object.metadata.name)
              .then(() => UnlockResourcePoller.clearPoller(object.metadata.name, intervalId));
          }
        })
        .catch(NotFound, err => {
          logger.info('Resource not found : ', err);
          return lockManager.unlock(object.metadata.name)
            .then(() => UnlockResourcePoller.clearPoller(object.metadata.name, intervalId));
        });
    }
    /*
    Starts poller whenever a lock resource is created.
    Polling for only backup operations
    */

    function startPoller(event) {
      logger.debug('Received Lock Event: ', event);
      const lockDetails = JSON.parse(event.object.spec.options);
      if (event.type === CONST.API_SERVER.WATCH_EVENT.ADDED && lockDetails.lockedResourceDetails.resourceGroup === CONST.APISERVER.RESOURCE_GROUPS.BACKUP) {
        UnlockResourcePoller.clearPoller(event.object.metadata.name, UnlockResourcePoller.pollers[event.object.metadata.name]);
        logger.info('starting unlock resource poller for deployment', event.object.metadata.name);
        //TODO-PR - its better to convert this to a generic unlocker, which unlocks all types of resources.
        // It can watch on all resources which have completed their operation whose state can be 'Done' and post unlocking it can update it as 'Completed'.
        const intervalId = setInterval(() => poller(event.object, intervalId), CONST.UNLOCK_RESOURCE_POLLER_INTERVAL);
        UnlockResourcePoller.pollers[event.object.metadata.name] = intervalId;
      }
    }
    return eventmesh.apiServerClient.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, startPoller)
      .then(stream => {
        logger.debug(`Successfully set watcher on resource group ${CONST.APISERVER.RESOURCE_GROUPS.LOCK} and resource ${CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS}`);
        return Promise
          .delay(CONST.APISERVER.WATCHER_REFRESH_INTERVAL)
          .then(() => {
            logger.debug(`Refreshing stream after ${CONST.APISERVER.WATCHER_REFRESH_INTERVAL}`);
            stream.abort();
            return this.start();
          });
      })
      .catch(e => {
        logger.error(`Error occured in registerWatcher:`, e);
        return Promise
          .delay(CONST.APISERVER.WATCHER_ERROR_DELAY)
          .then(() => {
            logger.info(`Refreshing stream after ${CONST.APISERVER.WATCHER_ERROR_DELAY}`);
            return this.start();
          });
      });
  }
  static clearPoller(resourceId, intervalId) {
    logger.info(`Clearing unlock interval for deployment`, resourceId);
    if (intervalId) {
      clearInterval(intervalId);
    }
    _.unset(UnlockResourcePoller.pollers, resourceId);
  }
}

UnlockResourcePoller.pollers = {};
pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
  logger.debug('-> Received event ->', eventName);
  if (eventInfo.type === 'internal') {
    return eventmesh.apiServerClient.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS)
      .then(() => UnlockResourcePoller.start());
  }
});
module.exports = UnlockResourcePoller;