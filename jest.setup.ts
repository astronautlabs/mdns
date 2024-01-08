import * as chai from 'chai';
import "sinon-chai";
import "chai-as-promised";

import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(sinonChai);
chai.use(chaiAsPromised);

// process.on('unhandledRejection', (reason, promise) => {
// 	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
// 	// Application specific logging, throwing an error, or other logic here
// });