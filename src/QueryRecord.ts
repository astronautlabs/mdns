import { hash } from './hash';
import { RClass, RNums, RType } from './constants';
import { HashableRecord } from './RecordCollection';

import * as misc from './misc';

export interface QueryRecordInit {
  name: string;
  qtype?: number;
  qclass?: number;
  QU?: boolean;
}

/**
 * Create/parse query records
 * @class
 *
 * Create a new QueryRecord:
 * > const record = new QueryRecord({name: 'Target.local.'});
 *
 * Parse a QueryRecord from a buffer (a wrapped buffer):
 * > const record = QueryRecord.fromBuffer(wrapper);
 *
 */
export class QueryRecord implements HashableRecord {
  constructor(fields: QueryRecordInit) {
    this.name   = fields.name;
    this.qtype  = fields.qtype  || RType.ANY;
    this.qclass = fields.qclass || RClass.IN;
    this.QU     = fields.QU     || false;

    // for comparing queries and answers:
    this.hash = hash(this.name, this.qtype, this.qclass);
    this.namehash = this.hash;
  }

  name: string;
  hash: string;
  namehash: string;
  qtype: number;
  qclass: number;
  QU: boolean;

  /**
   * @param  {BufferWrapper} wrapper
   * @return {QueryRecord}
   */
  static fromBuffer(wrapper) {
    const name = wrapper.readFQDN();
    const qtype = wrapper.readUInt16BE();
    const classBit  = wrapper.readUInt16BE(); // top bit of rrclass field reused as QU/QM bit

    return new QueryRecord({
      name,
      qtype,
      qclass: classBit & ~0x8000,
      QU:     !!(classBit & 0x8000)
    });
  }

  /**
   * @param {BufferWrapper} wrapper
   */
  writeTo(wrapper) {
    // flip top bit of qclass to indicate a QU question
    const classField = (this.QU)
      ? this.qclass | 0x8000
      : this.qclass;

    wrapper.writeFQDN(this.name);
    wrapper.writeUInt16BE(this.qtype);
    wrapper.writeUInt16BE(classField);
  }

  /**
   * Check if a query recrod is the exact same as this one (ANY doesn't count)
   */
  equals(queryRecord) {
    return (this.hash === queryRecord.hash);
  }

  /**
   * Breaks up the record into an array of parts. Used in misc.alignRecords
   * so stuff can get printed nicely in columns. Only ever used in debugging.
   */
  toParts() {
    const type = RNums[this.qtype] || this.qtype;

    return [
      this.name,
      misc.color(type, 'blue'),
      (this.QU) ? misc.color('QU', 'yellow') : 'QM',
    ];
  }

  toString() {
    return this.toParts().join(' ');
  }
}