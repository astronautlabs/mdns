export interface HashableRecord {
  hash: string;
  conflictsWith?(record: HashableRecord);
}

/**
 * Creates a new RecordCollection
 * @class
 *
 * RecordSet might have been a better name, but a 'record set' has a specific
 * meaning with dns.
 *
 * The 'hash' property of HashableRecords/QueryRecords is used to keep items in
 * the collection/set unique.
 */
export class RecordCollection<T extends HashableRecord> {
  /**
   * @param {ResorceRecord[]} [records] - optional starting records
   */
  constructor(records: T[] = []) {
    this._records = {};

    if (records) this.addEach(records);
  }

  size: number = 0;
  private _records: Record<string, T>;

  has(record: T) {
    return record.hash in this._records;
  }

  hasEach(records: RecordCollection<T> | T[]) {
    return records.every(record => this.has(record));
  }

  hasAny(records: RecordCollection<T> | T[]) {
    return !!this.intersection(records).size;
  }

  /**
   * Retrieves the equivalent record from the collection
   *
   * Eg, for two equivalent records A and B:
   *   A !== B                  - different objects
   *   A.equals(B) === true     - but equivalent records
   *
   *   collection.add(A)
   *   collection.get(B) === A  - returns object A, not B
   */
  get(record) {
    return (this.has(record)) ? this._records[record.hash] : undefined;
  }

  add(record: T) {
    if (!this.has(record)) {
      this._records[record.hash] = record;
      this.size++;
    }
  }

  addEach(records: T[]) {
    records.forEach(record => this.add(record));
  }

  delete(record) {
    if (this.has(record)) {
      delete this._records[record.hash];
      this.size--;
    }
  }

  clear() {
    this._records = {};
    this.size = 0;
  }

  rebuild() {
    const records = this.toArray();

    this.clear();
    this.addEach(records);
  }

  toArray() {
    return Object.values(this._records);
  }

  forEach(fn: (record: T) => void) {
    this.toArray().forEach(x => fn(x));
  }

  /**
   * @return {RecordCollection} - a new record collection
   */
  filter(fn: (record: T) => boolean) {
    return new RecordCollection(this.toArray().filter(record => fn(record)));
  }

  /**
   * @return {RecordCollection} - a new record collection
   */
  reject(fn: (record: T) => boolean) {
    return this.filter(r => !fn(r));
  }

  /**
   * @return {Ts[]} - array, not a new record collection
   */
  map<U>(fn: (record: T) => U): U[] {
    return this.toArray().map(r => fn(r));
  }

  reduce(fn: (previousValue: T, currentValue: T, currentIndex: number) => T);
  reduce<R>(fn: (previousValue: R, currentValue: T, currentIndex: number) => R, initialValue: R);
  reduce<R>(fn: (previousValue: R, currentValue: T, currentIndex: number) => R, initialValue?: R) {
    return this.toArray().reduce((pv, cv, ci) => fn(pv, cv, ci), initialValue);
  }

  some(fn: (record: T) => boolean) {
    return this.toArray().some(r => fn(r));
  }

  every(fn: (record: T) => boolean) {
    return this.toArray().every(r => fn(r));
  }

  /**
   * @param  {RecordCollection|Ts[]} values - array or collection
   * @return {boolean}
   */
  equals(values: RecordCollection<T> | T[]) {
    const otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    if (this.size !== otherSet.size) return false;

    return this.every(record => otherSet.has(record));
  }

  /**
   * Returns a new RecordCollection containing the values of this collection
   * minus the records contained in the other record collection
   *
   * @param  {RecordCollection|Ts[]} values
   * @return {RecordCollection}
   */
  difference(values) {
    const otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    return this.reject(record => otherSet.has(record));
  }

  /**
   * Returns a new RecordCollection containing the values that exist in both
   * this collection and in the other record collection
   *
   * @param  {RecordCollection|Ts[]} values
   * @return {RecordCollection}
   */
  intersection(values: RecordCollection<T> | T[]) {
    const otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    return this.filter(record => otherSet.has(record));
  }

  /**
   * Checks if a group of records conflicts in any way with this set.
   * Returns all records that are conflicts out of the given values.
   *
   * Records that occur in both sets are ignored when check for conflicts.
   * This is to deal with a scenario like this:
   *
   * If this set has:
   *   A 'host.local' 1.1.1.1
   *   A 'host.local' 2.2.2.2
   *
   * And incoming set look like:
   *   A 'host.local' 1.1.1.1
   *   A 'host.local' 2.2.2.2
   *   A 'host.local' 3.3.3.3  <------ extra record
   *
   * That extra record shouldn't be a conflict with 1.1.1.1 or 2.2.2.2,
   * its probably bonjour telling us that there's more addresses that
   * can be used that we're not currently using.
   */
  getConflicts(values: RecordCollection<T> | T[]) {
    let otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    // remove records that aren't conflicts
    const thisSet = this.difference(otherSet);
    otherSet = otherSet.difference(this);

    // find all records from the other set that conflict
    const conflicts = otherSet.filter(otherRecord =>
      thisSet.some(thisRecord => thisRecord.conflictsWith?.(otherRecord) ?? false));

    return conflicts.toArray();
  }
}