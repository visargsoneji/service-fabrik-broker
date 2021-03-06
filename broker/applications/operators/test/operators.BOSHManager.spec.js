'use strict';

const JSONStream = require('json-stream');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const config = require('@sf/app-config');
const { CONST } = require('@sf/common-utils');
const {
  ApiServerClient,
  apiServerClient
} = require('@sf/eventmesh');

const service_id = '3c266123-8e6e-4034-a2aa-e48e13fbf893';
const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
const space_guid = 'fe171a35-3107-4cee-bc6b-0051617f892e';
const organization_guid = '00060d60-067d-41ee-bd28-3bd34f220036';
const jsonWriteDelay = 50;

const BoshOperatorDummy = {
  registerWatcherDummy: () => {},
  createDirectorServiceDummy: () => {},
  createDummy: () => {},
  updateDummy: () => {},
  deleteDummy: () => {},
  getOperationOptionsDummy: () => {}
};
const resultOptions = {
  plan_id: plan_id
};
const BoshOperator = proxyquire('../src/bosh-operator/BoshOperator', {
  '@sf/eventmesh': {
    'apiServerClient': {
      'getOptions': function (opts) {
        BoshOperatorDummy.getOperationOptionsDummy(opts);
        return Promise.resolve(resultOptions);
      }
    }
  },
  '@sf/provisioner-services': { 
    DirectorService: {
    'createInstance': function (instance_id, options) {
      BoshOperatorDummy.createDirectorServiceDummy(instance_id, options);
      return Promise.resolve({
        'create': opts => {
          BoshOperatorDummy.createDummy(opts);
          return Promise.resolve({});
        },
        'update': opts => {
          BoshOperatorDummy.updateDummy(opts);
          return Promise.resolve({});
        },
        'delete': opts => {
          BoshOperatorDummy.deleteDummy(opts);
          return Promise.resolve({});
        }
      });
    }
  }
  }
});

function initDefaultBMTest(jsonStream, sandbox, registerWatcherStub) {
  /* jshint unused:false */
  const bm = new BoshOperator();
  bm.init();
  return Promise.delay(100)
    .then(() => {
      expect(registerWatcherStub.callCount).to.equal(1);
      expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT);
      expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      expect(registerWatcherStub.firstCall.args[3]).to.eql('state in (in_queue,update,delete)');
      registerWatcherStub.restore();
    });
}

describe('operators', function () {
  describe('BoshOperator', function () {
    let createDirectorServiceSpy, createSpy, updateSpy, deleteSpy, getOperationOptionsSpy, registerWatcherStub, sandbox;
    let jsonStream;
    let registerWatcherFake;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      createDirectorServiceSpy = sinon.spy(BoshOperatorDummy, 'createDirectorServiceDummy');
      createSpy = sinon.spy(BoshOperatorDummy, 'createDummy');
      updateSpy = sinon.spy(BoshOperatorDummy, 'updateDummy');
      deleteSpy = sinon.spy(BoshOperatorDummy, 'deleteDummy');
      getOperationOptionsSpy = sinon.spy(BoshOperatorDummy, 'getOperationOptionsDummy');
      jsonStream = new JSONStream();
      registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
    });

    afterEach(function () {
      sandbox.restore();
      createDirectorServiceSpy.restore();
      createSpy.restore();
      updateSpy.restore();
      deleteSpy.restore();
      getOperationOptionsSpy.restore();
      registerWatcherStub.restore();
    });

    it('Should not process create request if already being processed', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
            annotations: {
              lockedByManager: '10.0.2.2',
              processingStartedAt: new Date()
            }
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_progress'
          }
        }
      };
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);

      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should process create request successfully if processing time expired', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
            annotations: {
              lockedByManager: '10.0.2.2',
              processingStartedAt: new Date(new Date() - 600000)
            }
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object, 2);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);


      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createDirectorServiceSpy.firstCall.args[1]).to.eql(options);
          expect(createSpy.callCount).to.equal(1);
          expect(createSpy.firstCall.args[0]).to.eql(options);
          mocks.verify();
        });
    });

    it('Should process create request successfully', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object, 2);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);


      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createDirectorServiceSpy.firstCall.args[1]).to.eql(options);
          expect(createSpy.callCount).to.equal(1);
          expect(createSpy.firstCall.args[0]).to.eql(options);
          mocks.verify();
        });
    });

    it('Should process update request successfully', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'update'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object, 2);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);

      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(1);
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createDirectorServiceSpy.firstCall.args[1]).to.eql(options);
          expect(updateSpy.callCount).to.equal(1);
          expect(updateSpy.firstCall.args[0]).to.eql(options);
          mocks.verify();
        });
    });

    it('Should process delete request successfully', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'delete'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object, 2);

      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(1);
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createDirectorServiceSpy.firstCall.args[1]).to.eql(options);
          expect(deleteSpy.callCount).to.equal(1);
          expect(deleteSpy.firstCall.args[0]).to.eql(options);
          mocks.verify();
        });
    });

    it('Should not process request if already being served', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
            annotations: {
              lockedByManager: config.broker_ip
            }
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };

      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should not process request if processing lock is not acquired', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object, 1, undefined, 409);

      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should handle acquire processing lock error gracefully', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object, 1, undefined, 404);

      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should not process request if already picked by other process', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
            annotations: {
              lockedByManager: '10.12.12.12'
            }
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };

      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should gracefully handle errors occured while releasing processing lock', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object);
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, changeObject.object, 1, undefined, 404);

      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createSpy.callCount).to.equal(1);
          expect(createSpy.firstCall.args[0]).to.eql(options);
          mocks.verify();
        });
    });

  });
});
