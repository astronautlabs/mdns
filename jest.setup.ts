import * as chai from 'chai';
import "sinon-chai";
import sinonChai from 'sinon-chai';

chai.use(sinonChai);

// process.on('unhandledRejection', (reason, promise) => {
// 	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
// 	// Application specific logging, throwing an error, or other logic here
// });