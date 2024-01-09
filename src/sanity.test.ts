import { expect } from 'chai';
import { jest } from '@jest/globals';

import { Browser } from './Browser';
import { Advertisement } from './Advertisement';
import { ServiceType } from './ServiceType';
import { MulticastDNS } from './MulticastDNS';
import { Platform } from './Platform';

import _ from 'lodash';
import { Service } from './Service';

jest.setTimeout(240_000); // these will take a while

describe('Sanity tests:', function() {
  // Perform a test where we create an advertisement for a TCP service on the current host (under the _test 
  // service namespace) and monitor that advertisement with a Browser. When we see the service become available,
  // we'll tell the advertisement to end, which will cause the serviceDown event to occur for that service.
  // Once we receive serviceDown, we'll end the browser. This should take about 3.5s on a heavily populated 
  // (30 mDNS device) network.
  it('advertisement and browser should talk to each other', function(done) {
    const ad = new Advertisement('_test._tcp', 4444, {name: 'Test #1'}).start();

    const browser = new Browser(ServiceType.tcp('test'))
      .on('serviceUp', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          ad.stop();
        }
      })
      .on('serviceDown', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          browser.stop();
          done();
        }
      })
      .start();
  });

  // Advertise a service with for this host with a specified service namespace (`_test._tcp`),
  // wait for it to be active, then start another advertisement for the same host and service 
  // namespace but with a different port. The second advertisement should receive a conflict 
  // rename notification ('instanceRenamed'), but the first should not be affected.
  // This test can take about 120 seconds on a heavily populated network (30 mDNS devices).
  it('advertisements should rename if they find a conflict', function(done) {
    const options = {name: 'Test #2'};
    const callback = _.after(3, done);
    let ad_1, ad_2;

    function stop() {
      ad_1.stop(false, callback);
      ad_2.stop(false, callback);
    }

    ad_2 = new Advertisement('_test._tcp', 5555, options) // <-- conflicting port!
      .on('instanceRenamed', (name) => {
        expect(name).to.equal('Test #2 (2)');
        callback(); // must be called for test to complete
      })
      .on('active', () => stop());

    ad_1 = new Advertisement(ServiceType.tcp('test'), 4444, options)
      .on('instanceRenamed', () => { done(new Error('First service was renamed! There should not have been a conflict yet!')); })
      .on('active', () => {
        ad_2.start()
      })
      .start();
  });

  // Create two service advertisements on the same host, for the same service namespace, on the 
  // same port. Neither advertisement needs to be renamed, since they are identical.
  // This test can take about 60 seconds on a heavily populated network (30 devices).
  it('advertisements should not rename if without conflict', function(done) {
    const options = {name: 'Test #3'};
    const callback = _.after(2, done);
    let ad_1, ad_2;

    function stop() {
      ad_1.stop(false, callback);
      ad_2.stop(false, callback);
    }

    ad_2 = new Advertisement('_test._tcp', 4444, options) // <-- NO conflict
      .on('instanceRenamed', () => { throw new Error('Was renamed!'); })
      .on('active', () => stop());

    ad_1 = new Advertisement(ServiceType.tcp('test'), 4444, options)
      .on('instanceRenamed', () => { throw new Error('Was renamed!'); })
      .on('active', () => ad_2.start())
      .start();
  });

  // Create an advertisement and then see that the resolve.resolveService() convenience API
  // can find it. This can take about 60 seconds on a heavily populated network (30 devices).
  it('should be able to resolve from an advertisement', function(done) {
    let ad = new Advertisement(ServiceType.tcp('test'), 4444, {name: 'Test #3'})
      .on('active', async () => {
        const fullname = 'Test #3._test._tcp.local.';
  
        let service: Service;
        
        try {
          service = await Browser.resolveService(fullname)
        } catch(err) {
          ad.stop(false, () => done(err));
          return;
        }
   
        try {
          expect(service.name).to.equal(ad.instanceName);
          expect(service.port).to.equal(4444);
          expect(service.type).to.eql({name: 'test', protocol: 'tcp'});
          expect(service.txt).to.eql({});
        } catch (e) {
          done(e);
          return;
        }

        ad.stop(false, done);
      })
      .start();
  });

  // Start an advertisement, then use a Browser to listen to the advertisement. When the 
  // browser sees the advertised service as up, change the advertisement to include an updated
  // TXT record. When the browser sees the updated TXT record, stop the browser and the advertisement
  // and consider the test a success.
  // This is a quick one, should only take about 3 seconds on a heavily populated network (30 devices).
  it('browsers should listen to advertisement changes', function(done) {
    let updated = false;

    const ad = new Advertisement('_test._tcp', 4444, {name: 'Test #4'}).start();

    const browser = new Browser('_test._tcp')
      .on('serviceChanged', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          if (_(service.txt).isEqual({key: 'value'})) {
            browser.stop();
            ad.stop(false, done);
          }
        }
      })
      .on('serviceUp', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          setTimeout(() => {
            ad.updateTXT({key: 'value'});
            updated = true;
          });
        }
      })
      .start();
  });

  // Start an advertisement, then start a browser to listen for it. When the browser sees the 
  // service come up, stop the advertisement, and when the service comes back down, stop the 
  // browser. But this time, pick a specific network interface to perform the test on. 
  // We don't validate that the activity _actually_ happens on the chosen interface though.
  // TODO: find ways to do that
  // This test is quick, about 4 seconds on a heavily populated network (30 devices).
  it('advertisement / browser interface option should work', function(done) {
    const name = Object.keys(Platform.getNetworkInterfaces())[0];
    const options = { name: 'Test #5', interface: name };

    const ad = new Advertisement('_test._tcp', 4444, options).start();

    const browser = new Browser(ServiceType.tcp('test'), options)
      .on('serviceUp', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          ad.stop();
        }
      })
      .on('serviceDown', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          browser.stop();
          done();
        }
      })
      .start();
  });
});
