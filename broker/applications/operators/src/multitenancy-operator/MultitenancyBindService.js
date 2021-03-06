'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const logger = require('@sf/logger');
const {
  CONST,
  commonFunctions: {
    maskSensitiveInfo,
    decodeBase64
  }
} = require('@sf/common-utils');
const { catalog } = require('@sf/models');
const { director } = require('@sf/bosh');
const { apiServerClient } = require('@sf/eventmesh');
const MultitenancyAgent = require('./MultitenancyAgent');
const BaseService = require('../../../../core/provisioner-services/src/BaseService');


class MultitenancyBindService extends BaseService {

  constructor(guid, plan, parameters, bindResourceType, deploymentResourceType) {
    super(plan);
    this.guid = guid;
    this.parameters = parameters;
    this.director = director;
    this.agent = new MultitenancyAgent(this.settings.agent);
    this.bindResourceType = bindResourceType;
    this.deploymentResourceType = deploymentResourceType;
  }

  initialize() {
    return apiServerClient.getResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: this.deploymentResourceType,
      resourceId: this.guid
    }).then(resourcebody => {
      this.deploymentName = resourcebody.operatorMetadata.dedicatedInstanceDeploymentName;
      logger.info(`Dedicated instance deployment name is '${this.deploymentName}'...`);
    });
  }

  bind(params) {
    return this.initialize()
      .then(() => this.createBinding(this.deploymentName, this.guid, {
        id: params.binding_id,
        parameters: params.parameters || {}
      }));
  }

  createBinding(deploymentName, instanceId, binding) {
    logger.info(`Creating binding '${binding.id}' with binding parameters '${JSON.stringify(binding.parameters)}' for instance '${instanceId}'...`);
    return this.director.getDeploymentIps(deploymentName)
      .then(ips => this.agent.createTenantCredentials(ips, instanceId, binding.parameters))
      .tap(credentials => {
        _.set(binding, 'credentials', credentials);
        const bindCreds = _.cloneDeep(binding.credentials);
        maskSensitiveInfo(bindCreds);
        logger.info(`+-> Created binding:${JSON.stringify(bindCreds)}`);
      })
      .catch(err => {
        logger.error(`+-> Failed to create binding for deployment ${deploymentName} with id ${binding.id}`, err);
        throw err;
      });
  }

  unbind(params) {
    return this.initialize()
      .then(() => this.deleteBinding(this.deploymentName, this.guid, params.binding_id));
  }

  deleteBinding(deploymentName, instanceId, bindingId) {
    logger.info(`Deleting binding '${bindingId}' for deployment '${deploymentName}' , instance '${instanceId}'...`);
    return Promise
      .all([
        this.director.getDeploymentIps(deploymentName),
        this.getCredentialsFromResource(bindingId)
      ])
      .spread((ips, credentials) => this.agent.deleteTenantCredentials(ips, instanceId, credentials))
      .tap(() => logger.info(`+-> Deleted service binding with id ${bindingId}`))
      .catch(err => {
        logger.error(`+-> Failed to delete binding for deployment ${deploymentName} with binding id ${bindingId}`, err);
        throw err;
      });
  }

  getCredentialsFromResource(id) {
    logger.info(`[getCredentials] making request to ApiServer for binding ${id}`);
    return apiServerClient.getResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
      resourceType: this.bindResourceType,
      resourceId: id
    })
      .then(resource => {
        let response = _.get(resource, 'status.response', undefined);
        if (!_.isEmpty(response)) {
          return decodeBase64(response);
        }
      })
      .catch(err => {
        logger.error(`[getCredentials] error while fetching resource for binding ${id} - `, err);
        throw err;
      });
  }

  static createInstance(instanceId, options, bindResourceType, deploymentResourceType) {
    assert.ok(options.plan_id, 'Plan ID must be available');
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const parameters = _.get(options, 'parameters');
    const multitenancyBindService = new MultitenancyBindService(instanceId, plan, parameters, bindResourceType, deploymentResourceType);
    return Promise.resolve(multitenancyBindService);
  }
}

module.exports = MultitenancyBindService;
