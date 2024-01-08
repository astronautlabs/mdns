import { expect } from 'chai';
import { jest } from '@jest/globals';

import sinon from 'sinon';
import _ from 'lodash';

import { TimerContainer } from './TimerContainer';

jest.useFakeTimers();

describe('TimerContainer', () => {
  describe('.set', () => {
    it('should have name be optional', () => {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.set(() => context.fn(), 1000);

      jest.advanceTimersByTime(1000);
      expect(context.fn).to.have.been.called;
    });

    it('should clear old timers with the same name', () => {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.set('name', () => context.fn(), 1000);
      timers.set('name', () => context.fn(), 5000);

      jest.advanceTimersByTime(1000);
      expect(context.fn).to.not.have.been.called;

      jest.advanceTimersByTime(5000);
      expect(context.fn).to.have.been.called;
    });
  });


  describe('.setLazy', () => {
    it('should add a timer that fires', () => {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.setLazy('name', () => context.fn(), 1000);

      jest.advanceTimersByTime(1000);
      expect(context.fn).to.have.been.called;
    });

    it('should have name be optional', () => {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.setLazy(() => context.fn(), 1000);

      jest.advanceTimersByTime(1000);
      expect(context.fn).to.have.been.called;
    });

    it('should clear old timers with the same name', () => {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.setLazy('name', () => context.fn(), 1000);
      timers.setLazy('name', () => context.fn(), 5000);

      jest.advanceTimersByTime(1000);
      expect(context.fn).to.not.have.been.called;
      expect(timers.has('name')).to.be.true;

      jest.advanceTimersByTime(5000);
      expect(context.fn).to.have.been.called;
      expect(timers.has('name')).to.be.false;
    });

    it('should NOT run fn if the timer goes off late', () => {
      const now = sinon.stub();
      now.onFirstCall().returns(0);
      now.onSecondCall().returns(30 * 1000);

      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.setLazy(() => context.fn(), 1000);

      jest.setSystemTime(Date.now() + 30 * 1000);
      jest.advanceTimersByTime(30 * 1000);

      expect(context.fn).to.not.have.been.called;
    });
  });


  describe('.clear', () => {
    it('should clear old timers with the same name', () => {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.set(() => context.fn(), 1000);
      timers.set(() => context.fn(), 1000);
      timers.setLazy(() => context.fn(), 1000);
      timers.setLazy(() => context.fn(), 1000);
      timers.clear();

      jest.advanceTimersByTime(1000);
      expect(context.fn).to.not.have.been.called;
    });
  });


  describe('.has', () => {
    it('should be true/false if timer was set', () => {
      const timers = new TimerContainer();

      timers.set('normal', () => {}, 1000);
      timers.setLazy('lazy', () => {}, 1000);

      expect(timers.has('normal')).to.be.true;
      expect(timers.has('lazy')).to.be.true;
      expect(timers.has('unknown')).to.be.false;
      timers.clear();
    });
  });


  describe('.count', () => {
    it('should return number of timers currently set', () => {
      const timers = new TimerContainer();

      timers.set(() => {}, 1000);
      timers.setLazy(() => {}, 1000);

      expect(timers.count()).to.equal(2);
      timers.clear();
      expect(timers.count()).to.equal(0);
    });
  });

});
