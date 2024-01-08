import { expect } from 'chai';
import sinon from 'sinon';

import { ServiceType } from './ServiceType';
import * as validate from './validate';

describe('ServiceType', () => {
  sinon.spy(ServiceType.prototype as any, '_fromString');
  sinon.spy(ServiceType.prototype as any, '_fromArray');
  sinon.spy(ServiceType.prototype as any, '_validate');
  sinon.spy(ServiceType.prototype as any, '_fromObj');

  describe('#constructor()', () => {
    it('should call this._fromString() on string', () => {
      const type = new ServiceType('_http._tcp');
      expect((type as any)._fromString).to.have.been.called;
    });

    it('should call this._fromArray() on array', () => {
      const type = new ServiceType(['_http', '_tcp']);
      expect((type as any)._fromArray).to.have.been.called;
    });

    it('should call this._fromObj() on object', () => {
      const type = new ServiceType({ name: '_http', protocol: '_tcp' });
      expect((type as any)._fromObj).to.have.been.called;
    });

    it('should throw an error for any other input type', () => {
      expect(() => new ServiceType(99 as any)).to.throw();
    });
  });


  describe('#_fromString()', () => {
    it('should parse names without subtypes', () => {
      const input = '_http._tcp';
      const results = {};

      (ServiceType.prototype as any)._fromString.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: [],
      };

      expect(results).to.eql(expected);
    });

    it('should parse names with subtypes', () => {
      const input = '_http._tcp,sub1,sub2';
      const results = {};

      (ServiceType.prototype as any)._fromString.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results).to.eql(expected);
    });

    it('should trim off weird commas/whitespace', () => {
      const input = ' _http._tcp ,sub1,sub2, ';
      const results = {};

      (ServiceType.prototype as any)._fromString.call(results, input);
 
      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results).to.eql(expected);
    });

    it('should handle service enumerator string', () => {
      const input = '_services._dns-sd._udp';
      const results = {};

      (ServiceType.prototype as any)._fromString.call(results, input);

      const expected = {
        name:     '_services._dns-sd',
        protocol: '_udp',
        subtypes: [],
      };

      expect(results).to.eql(expected);
    });
  });


  describe('#_fromArray()', () => {
    it('should handle nested array', () => {
      const input = ['_http', '_tcp', ['sub1', 'sub2']];
      const results = {_fromObj: sinon.stub()};

      (ServiceType.prototype as any)._fromArray.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results._fromObj).to.have.been.calledWithMatch(expected);
    });

    it('should handle flat array too', () => {
      const input = ['_http', '_tcp', 'sub1', 'sub2'];
      const results = {_fromObj: sinon.stub()};

      (ServiceType.prototype as any)._fromArray.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results._fromObj).to.have.been.calledWithMatch(expected);
    });
  });


  describe('#_fromObj()', () => {
    it('should cast subtypes to array', () => {
      const results = {};

      const input = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: 'sub1',
      };

      (ServiceType.prototype as any)._fromObj.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1'],
      };

      expect(results).to.eql(expected);
    });

    it('should use name, protocol, subs and ignore other properties', () => {
      const results = {};

      const input = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1'],
        ignore:   'ok',
      };

      (ServiceType.prototype as any)._fromObj.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1'],
      };

      expect(results).to.eql(expected);
    });
  });


  describe('#_validate()', () => {
    const validateSpy = {
      serviceName: sinon.spy(validate, 'serviceName'),
      protocol   : sinon.spy(validate, 'protocol'),
      label      : sinon.spy(validate, 'label'),
    };

    beforeEach(() => sinon.resetHistory());

    it('should throw error if name is missing / is not a string', () => {
      const input_1 = {name: 4};
      const input_2 = {name: ''};

      expect((ServiceType.prototype as any)._validate.bind(input_1)).to.throw(Error);
      expect((ServiceType.prototype as any)._validate.bind(input_2)).to.throw(Error);
    });

    it('should throw error if protocol is missing / is not a string', () => {
      const input_1 = {name: '_http', protocol: 4};
      const input_2 = {name: '_http', protocol: ''};

      expect((ServiceType.prototype as any)._validate.bind(input_1)).to.throw(Error);
      expect((ServiceType.prototype as any)._validate.bind(input_2)).to.throw(Error);
    });

    it('should be forgiving about underscores in name/protocol', () => {
      const context = {
        name:     'http',
        protocol: 'tcp',
        subtypes: [],
      };

      (ServiceType.prototype as any)._validate.call(context);

      expect(context.name).to.equal('_http');
      expect(context.protocol).to.equal('_tcp');
    });

    it('should run validation on name, protocol, and subtypes', () => {
      const context = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: [],
      };

      (ServiceType.prototype as any)._validate.call(context);

      expect(validateSpy.serviceName).to.have.been.called;
      expect(validateSpy.protocol).to.have.been.called;
      expect(validateSpy.label).to.have.callCount(context.subtypes.length);
    });

    it('should *not* run validation on service enumerator types', () => {
      const context: Partial<ServiceType> = {
        name:     '_services._dns-sd',
        protocol: '_udp',
        subtypes: ['sub1', 'sub2'],
      };

      (ServiceType.prototype as any)._validate.call(context);

      expect(context.subtypes).to.be.empty;
      expect(context.isEnumerator).to.be.true;
      expect(validateSpy.serviceName).to.not.have.been.called;
    });
  });


  describe('#toString()', () => {
    it('should spit out a valid string without subtypes', () => {
      const context = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: [],
      };

      const result = ServiceType.prototype.toString.call(context);

      expect(result).to.equal('_http._tcp');
    });

    it('should spit out a valid string with subtypes', () => {
      const context = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      const result = ServiceType.prototype.toString.call(context);

      expect(result).to.equal('_http._tcp,sub1,sub2');
    });
  });


  describe('::tcp()', () => {
    it('should throw error if service is missing / is not a string', () => {
      expect(ServiceType.tcp.bind(null)).to.throw(Error);
      expect(ServiceType.tcp.bind(null, '')).to.throw(Error);
    });

    it('should return a correct TCP ServiceType', () => {
      // single string
      expect(ServiceType.tcp('_http'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'});

      // name and subtype
      expect(ServiceType.tcp(['_http', 'sub1']))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'})
        .to.property('subtypes').eql(['sub1']);

      // name and subtypes
      expect(ServiceType.tcp(['_http', 'sub1', 'sub2']))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);

      // name and subtypes as string
      expect(ServiceType.tcp('_http,sub1,sub2'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);
    });
  });


  describe('::udp()', () => {
    it('should throw error if service is missing / is not a string', () => {
      expect(ServiceType.udp.bind(null)).to.throw(Error);
      expect(ServiceType.udp.bind(null, '')).to.throw(Error);
    });

    it('should return a correct UDP ServiceType', () => {
      // single string
      expect(ServiceType.udp('_sleep-proxy'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'});

      // name and subtype
      expect(ServiceType.udp(['_sleep-proxy', 'sub1']))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'})
        .to.property('subtypes').eql(['sub1']);

      // name and subtypes
      expect(ServiceType.udp(['_sleep-proxy', 'sub1', 'sub2']))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);

      // name and subtypes as string
      expect(ServiceType.udp('_sleep-proxy,sub1,sub2'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);
    });
  });


  describe('::all()', () => {
    it('should return a correct enumerator ServiceType', () => {
      expect(ServiceType.all())
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_services._dns-sd', protocol: '_udp'})
        .to.have.property('isEnumerator', true);
    });
  });

});
