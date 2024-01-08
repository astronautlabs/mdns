# @/mdns

[![npm](https://img.shields.io/npm/v/@astronautlabs/mdns)](https://npmjs.com/package/@astronautlabs/mdns)
[![CircleCI](https://circleci.com/gh/astronautlabs/mdns.svg?style=svg)](https://circleci.com/gh/astronautlabs/mdns)

> **[📜 IETF RFC 6762](https://datatracker.ietf.org/doc/html/rfc6762)**  
> Multicast DNS

> **[📜 IETF RFC 6763](https://datatracker.ietf.org/doc/html/rfc6763)**  
> DNS-Based Service Discovery

> 📺 Part of the **Astronaut Labs Broadcast Suite**

> ⚠ **Production Quality**  
> This library is ready for use today (`v1.x.x`) but will be receiving substantial API upgrades and retooling to use 
> more of the `@astronautlabs/*` frameworks in `v2.x`, so expect fairly large compatibility changes when those 
> versions are released.

Fully featured mDNS and DNS-SD implementation in Typescript. No native dependencies, works alongside OS-level 
implementations as long as multiple UDP socket listeners are supported on your platform (supported in modern macOS, 
Windows, Linux). Extensive tests with continuous integration. Intended for use by Astronaut Labs' NMOS IS-04 
implementation, but usable for any general purpose mDNS/DNS-SD use cases.

```
npm install @astronautlabs/mdns
```

## Usage

Advertise an HTTP server on port 4321:

```ts
import { Advertisement } from '@astronautlabs/mdns';

const ad = new Advertisement('_http._tcp', 4321)
  .start();
```

Find all Google Cast compatible devices:

```ts
import { Browser } from '@astronautlabs/mdns';

new Browser('_googlecast._tcp')
  .on('serviceUp', service => console.log("Device up: ", service))
  .on('serviceDown', service => console.log("Device down: ", service))
  .start();
```

You can also use this library to query multicast DNS as you would unicast DNS using the `MulticastDNS` class.

```ts
import { MulticastDNS } from '@astronautlabs/mdns';
let ipAddress: string = await MulticastDNS.A('myService._http._tcp');
```

You can also use `MulticastDNS.query()` to retrieve the records themselves.

```ts
import { MulticastDNS, SRVRecord } from '@astronautlabs/mdns';

let { answer, related } = await MulticastDNS.query<SRVRecord>('myService._http._tcp', 'SRV');
// answer: SRVRecord, related: ResourceRecord[]
```

## Validation

Service type names and TXT records have some specific restrictions.

Service names:
* must start with an underscore _
* less than 16 chars including the leading _
* must start with a letter or digit
* only letters / digits / hyphens (but not consecutively: --)

TXT records:
* Keys <= 9 chars
* Keys must be ascii and can't use '='
* Values must be a string, buffer, number, or boolean
* Each key/value pair must be < 255 bytes
* Total TXT object is < 1300 bytes

# Credits

This package is based on [Gravity Software's `dnssd.js` package](https://gitlab.com/gravitysoftware/dnssd.js), which itself is based on [David Siegel's `mdns` package](https://github.com/agnat/node_mdns).