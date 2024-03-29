import { expect } from 'chai';

import stripAnsi from 'strip-ansi';

import * as hex from './hex';


describe('hex', function() {
  describe('.view()', function() {
    it('should not throw on random data', function() {
      expect(hex.view.bind(null, Buffer.alloc(1000))).to.not.throw();
    });

    it('should print ascii characters', function() {
      const input = Buffer.from('Printable: [ -~]');
      const output = stripAnsi(hex.view(input));
      const expected = '50 72 69 6e 74 61 62 6c 65 3a 20 5b 20 2d 7e 5d  Printable: [ -~]';

      expect(output).to.equal(expected);
    });

    it('should print dots for other stuff', function() {
      const input = Buffer.from('Dots: \x01\x02\x03\x04\x05\x06\x07\x08\x09\x10');
      const output = stripAnsi(hex.view(input));
      const expected = '44 6f 74 73 3a 20 01 02 03 04 05 06 07 08 09 10  Dots: ..........';

      expect(output).to.equal(expected);
    });

    it('should print in columns, even for lines <16 characters', function() {
      const input = Buffer.from('Columns!');
      const output = stripAnsi(hex.view(input));
      const expected = '43 6f 6c 75 6d 6e 73 21                          Columns!';

      expect(output).to.equal(expected);
    });
  });

});
