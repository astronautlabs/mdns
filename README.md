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

### <a name="new-advertisement"></a> new dnssd.Advertisement(serviceType, port [, options])

```js
// advertising a http server on port 4321:
const ad = new dnssd.Advertisement(dnssd.tcp('http'), 4321);
ad.start();
```

`options.name`      - instance name  
`options.host`      - hostname to use  
`options.txt`       - TXT record  
`options.subtypes`  - subtypes to register  
`options.interface` - interface name or address to use ('eth0' or '1.2.3.4')

#### <a name="advertisement-start"></a> .start()
Starts the advertisement.  
If there is a conflict with the instance name it will automatically get renamed. (`Name` -> `Name (2)`)

#### <a name="advertisement-stop"></a> .stop([forceImmediately [, callback]])
Stops the advertisement.  
Can do either a clean stop or a forced stop. A clean stop will send goodbye records out so others will know the service is going down. This takes ~1s. Forced goodbyes shut everything down immediately.

#### <a name="advertisement-on"></a> .on(event, listener)
`error`  
`stopped` when the advertisement is stopped  
`instanceRenamed` when the service instance has to be renamed  
`hostRenamed` when the hostname has to be renamed

#### <a name="advertisement-update-txt"></a> .updateTXT(txt)
Updates the advertisements TXT record

### <a name="new-browser"> new dnssd.Browser(serviceType [, options])

```js
// find all chromecasts
const browser = dnssd.Browser(dnssd.tcp('googlecast'))
  .on('serviceUp', service => console.log("Device up: ", service))
  .on('serviceDown', service => console.log("Device down: ", service))
  .start();
```

A resolved `service` looks like:
```js
service = {
  fullname: 'InstanceName._googlecast._tcp.local.',
  name: 'InstanceName',
  type: { name: 'googlecast', protocol: 'tcp' },
  domain: 'local',
  host: 'Hostname.local.',
  port: 8009,
  addresses: ['192.168.1.15'],
  txt: { id: 'strings' },
  txtRaw: { id: <Buffer XX XX XX... >},
};

```

Browser search is a multi-step process. First it finds an instance name, then it resolves all the necessary properties of the service, like the address and the port. It keeps that data up to date by sending more queries out as needed. If you want less steps, there's some options:

`options.maintain`: Set to false if don't want to maintain a service's info. This will give you a 'serviceUp' event but no 'serviceDown' or 'serviceUpdated'

`options.resolve`: Set to false if you only want the instance name and nothing else.

`options.interface`: Sets the interface to use ('eth0' or '1.2.3.4')

#### <a name="browser-start"></a> .start()
Starts the browser.

#### <a name="browser-stop"></a> .stop()
Stops the browser.

#### <a name="browser-on"></a> .on(event, listener)
`error`  
`serviceUp` when a new service is found  
`serviceChanged` when a service's data has changed  
`serviceDown` when a service goes down

#### <a name="browser-list"></a> .list()
Lists all current services that have been found.


### <a name="new-servicetype"></a> new dnssd.ServiceType(...args)

Used to turn some input into a reliable service type for advertisements and browsers. Name and protocol are always required, subtypes are optional. Multiple forms available:

**String** _(single argument)_
```js
'_http._tcp'
'_http._tcp,mysubtype,anothersub'
```

**Object** _(single argument)_
```js
{
  name:     '_http',
  protocol: '_tcp',
  subtypes: ['mysubtype', 'anothersub'],
}
```

**Array** _(single argument)_
```js
['_http', '_tcp', ['mysubtype', 'anothersub']]
['_http', '_tcp', 'mysubtype', 'anothersub']
```

**Strings** _(multiple arguments)_
```js
'_http', '_tcp'
'_http', '_tcp', 'mysubtype', 'anothersub'
```



### <a name="tcp"></a> dnssd.tcp(...args)
Creates a new ServiceType with tcp protocol

```js
ServiceType.tcp('_http')
ServiceType.tcp('_http', 'sub1', 'sub2')
ServiceType.tcp(['_http', 'sub1', 'sub2'])
```

### <a name="udp"></a> dnssd.udp(...args)
Creates a new ServiceType with udp protocol

```js
new ServiceType('_services._dns-sd._udp');
```

### <a name="all"></a> dnssd.all()
```js
// browse all the things
const browser = dnssd.Browser(dnssd.all())
```

### <a name="resolve"></a> dnssd.resolve(name, type [, options])
Async functions for resolving specific records / record types. Returns a promise with result.

```js
dnssd.resolve(name, rrtype).then(function(result) {})
result = {
    answer: {}
    related: [{}, {}]
}
```

#### <a name="resolve-a"></a> dnssd.resolveA(name [, options])
```js
dnssd.resolveA('something.local.').then((address) => {
  address === '192.168.1.10'
});
```

#### <a name="resolve-aaaa"></a> dnssd.resolveAAAA(name [, options])
```js
dnssd.resolveAAAA('computer.local.').then((address) => {
  address === '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
});
```

#### <a name="resolve-srv"></a> dnssd.resolveSRV(name [, options])
```js
dnssd.resolveSRV(name).then((srv) => {
  srv === {
      target: 'machine.local.',
      port: 8000,
  }
});
```

#### <a name="resolve-txt"></a> dnssd.resolveTXT(name [, options])
```js
dnssd.resolveTXT(name).then((txt) => {
  txt === { some: 'thing' }
});
```

#### <a name="resolve-service"></a> dnssd.resolveService(name [, options])
```js
dnssd.resolveService(name).then((service) => {
  service === like the browser results
});
```

<br />

## Validations
Service type names and TXT records have some restrictions:

serviceNames:  
\* must start with an underscore _  
\* less than 16 chars including the leading _  
\* must start with a letter or digit  
\* only letters / digits / hyphens (but not consecutively: --)  

TXT records  
\* Keys <= 9 chars  
\* Keys must be ascii and can't use '='  
\* Values must be a string, buffer, number, or boolean  
\* Each key/value pair must be < 255 bytes  
\* Total TXT object is < 1300 bytes  

<br/>


# Credits

This package is based on [Gravity Software's `dnssd.js` package](https://gitlab.com/gravitysoftware/dnssd.js), which itself is based on [David Siegel's `mdns` package](https://github.com/agnat/node_mdns).