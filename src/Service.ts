export interface Service {
    fullname: string;
    name: string;
    type: { name: string, protocol: string };
    domain: string;
    host: string;
    port: number;
    addresses: string[];
    txt: Record<string, true | string>;
    txtRaw: Record<string, true | Buffer>;
}
