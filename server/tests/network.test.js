import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress,publicURL} from '../src/network.js';
test('private and encoded local destinations are blocked before connection',async()=> {
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.2.2','192.168.0.1','100.64.1.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1']) assert.equal(isPublicAddress(ip),false,ip);
 for(const url of ['http://2130706433','http://0x7f000001','http://[::1]','file:///etc/passwd','https://user:pass@example.com','http://example.com:8796']) await assert.rejects(publicURL(url));
 assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
});
test('mixed public and private DNS results are rejected',async()=> {
 await assert.rejects(publicURL('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/blocked/);
});
