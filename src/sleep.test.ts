import { expect } from 'chai';
import { jest } from '@jest/globals';

import sinon from 'sinon';
import _ from 'lodash';

import { resetSleep, sleep } from './sleep';

jest.useFakeTimers();

describe('sleep', function() {
  it('should check for sleep and emit `wake` events', () => {
    // const now = sinon.stub(Date, 'now');
    // now.onFirstCall().returns(60 * 1000); // timer fires on time
    // now.onSecondCall().returns(31 * 60 * 1000); // timer fires 30min late

    resetSleep();

    const stub = sinon.stub();
    sleep.on('wake', stub);

    //jest.setSystemTime(Date.now() + 61*1000);
    jest.advanceTimersByTime(60 * 1000); // first interval ok

    jest.setSystemTime(Date.now() + 1000*60*60);
    jest.advanceTimersByTime(60 * 1000); // second interval emits wake

    expect(stub).to.have.been.calledOnce;
  });

  it('should prevent return-from-sleep thrashing', () => {
    // This test will simulate:
    // - 1 minute passing normally (the sleep timer fires successfully)
    // - 30 minutes of lockup or sleep without interval-skip (sleep timer should ignore)
    // - All 30 delayed intervals firing simultaneously, VM returns to active
    // - 1 minute passing normally (the sleep timer fires successfully)

    resetSleep();

    const stub = sinon.stub();
    sleep.on('wake', stub);

    jest.advanceTimersByTime(60 * 1000); // first interval ok

    jest.setSystemTime(Date.now() + 1000*60*30);
    for (let i = 0; i < 30; ++i) {
      jest.advanceTimersByTime(60 * 1000);
      jest.setSystemTime(Date.now() - 1000*60);
    }

    jest.setSystemTime(Date.now() + 1000*60); // undo the last offset
    jest.advanceTimersByTime(60 * 1000);
    expect(stub).to.have.been.calledTwice;
  });
});
