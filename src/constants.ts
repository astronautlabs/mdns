export const RType = {
  A    : 1,
  PTR  : 12,
  TXT  : 16,
  AAAA : 28,
  SRV  : 33,
  NSEC : 47,
  ANY  : 255,
};

export const RClass = {
  IN : 1,
  ANY: 255,
};

export const RNums = {
  1  : 'A',
  12 : 'PTR',
  16 : 'TXT',
  28 : 'AAAA',
  33 : 'SRV',
  47 : 'NSEC',
  255: 'ANY',
};
