import { Socket } from 'node:dgram';

import _ from 'lodash';
import sinon from 'sinon';
import { EventEmitter } from 'node:events';

import { Query } from '../Query';
import { Probe } from '../Probe';
import { ExpiringRecordCollection } from '../ExpiringRecordCollection';
import { NetworkInterface } from '../NetworkInterface';
import { DisposableInterface } from '../DisposableInterface';
import { GoodbyeResponse, MulticastResponse, UnicastResponse } from '../Response';
import { ServiceResolver } from '../ServiceResolver';
import { Responder } from '../Responder';


// adds reset method that resets all of the instances stubbed methods
function addResetHistory (stub) {
  stub.resetHistory = function() {
    _(stub).forOwn((value, key) => {
      if (stub[key] && typeof stub[key].resetHistory === 'function') {
        stub[key].resetHistory();
      }
    });
  };
}


function addProps(stub, props) {
  _.each(props, (value, key) => { stub[key] = value; });
}


function addEventEmitter(stub) {
  // dirty prototype rejig
  _.forIn(EventEmitter.prototype, (value, key) => { stub[key] = value; });

  // need to run contructor on it
  EventEmitter.call(stub);

  // make em spies
  sinon.spy(stub, 'emit');
  sinon.spy(stub, 'on');
  sinon.spy(stub, 'once');
  sinon.spy(stub, 'off');
  sinon.spy(stub, 'removeListener');
  sinon.spy(stub, 'removeAllListeners');
  // sinon.spy(stub, 'using');
  // sinon.spy(stub, 'removeListenersCreatedBy');

  // add to reset: reset stubs *and* remove listeners
  const original = stub.resetHistory;

  stub.resetHistory = function() {
    original();
    stub.removeAllListeners();
  };
}


/*
 * Stubs:
 */

function EventEmitterStub(props?) {
  const stub = sinon.createStubInstance(EventEmitter);
  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.off.returnsThis();
  stub.removeListener.returnsThis();
  stub.removeAllListeners.returnsThis();

  addEventEmitter(stub);
  return stub;
}

function ExpRecCollectionStub(props?) {
  const stub = sinon.createStubInstance(ExpiringRecordCollection);
  addResetHistory(stub);
  addProps(stub, props);

  addEventEmitter(stub);
  return stub;
}

function NetworkInterfaceStub(props?: Partial<NetworkInterface>) {
  const stub = sinon.createStubInstance(NetworkInterface);
  addResetHistory(stub);
  addProps(stub, props);

  stub.bind.returns(Promise.resolve());

  addEventEmitter(stub);
  return stub;
}

function DisposableInterfaceStub(props?: Partial<DisposableInterface>) {
  const stub = sinon.createStubInstance(DisposableInterface);
  addResetHistory(stub);
  addProps(stub, props);

  stub.bind.returns(Promise.resolve());

  addEventEmitter(stub);
  return stub;
}


function SocketStub(props?: Partial<Socket>) {
  const stub = sinon.createStubInstance(Socket);
  addResetHistory(stub);
  addProps(stub, props);

  addEventEmitter(stub);
  return stub;
}


function ProbeStub(props?: Partial<Probe>) {
  const stub = sinon.createStubInstance(Probe);
  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.bridgeable.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function QueryStub(props?: Partial<Query>) {
  const stub = sinon.createStubInstance(Query);
  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.setTimeout.returnsThis();
  stub.continuous.returnsThis();
  stub.ignoreCache.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function MulticastResponseStub(props?: Partial<MulticastResponse>) {
  const stub = sinon.createStubInstance(MulticastResponse);
  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.repeat.returnsThis();
  stub.defensive.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function UnicastResponseStub(props?: Partial<UnicastResponse>) {
  const stub = sinon.createStubInstance(UnicastResponse);
  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.defensive.returnsThis();
  stub.respondTo.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function GoodbyeStub(props?: Partial<GoodbyeResponse>) {
  const stub = sinon.createStubInstance(GoodbyeResponse);
  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.repeat.returnsThis();
  stub.defensive.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function ServiceResolverStub(props?: Partial<ServiceResolver>) {
  const stub = {
    start     : sinon.stub(),
    stop      : sinon.stub(),
    service   : sinon.stub(),
    isResolved: sinon.stub(),
    emit      : sinon.stub(),
    on        : sinon.stub(),
    once      : sinon.stub(),
    off       : sinon.stub(),
  };

  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.off.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function ResponderStub(props?: Partial<Responder>) {
  const stub = {
    start     : sinon.stub(),
    stop      : sinon.stub(),
    goodbye   : sinon.stub(),
    updateEach: sinon.stub(),
    getRecords: sinon.stub(),
    emit      : sinon.stub(),
    on        : sinon.stub(),
    once      : sinon.stub(),
    off       : sinon.stub(),
  };

  addResetHistory(stub);
  addProps(stub, props);

  // chainable methods
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.off.returnsThis();

  // callback methods
  stub.goodbye.yields();

  addEventEmitter(stub);
  return stub;
}

export { EventEmitterStub as EventEmitter };
export { ExpRecCollectionStub as ExpRecCollection };
export { NetworkInterfaceStub as NetworkInterface };
export { DisposableInterfaceStub as DisposableInterface };
export { SocketStub as Socket };
export { ProbeStub as Probe };
export { QueryStub as Query };
export { MulticastResponseStub as MulticastResponse };
export { UnicastResponseStub as UnicastResponse };
export { GoodbyeStub as Goodbye };
export { ServiceResolverStub as ServiceResolver };
export { ResponderStub as Responder };
