import * as os from 'os';

export class Platform {
    static getNetworkInterfaces() {
        return os.networkInterfaces();
    }
}