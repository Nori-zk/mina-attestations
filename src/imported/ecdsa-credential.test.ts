import { Bytes, zip } from '../util.ts';
import { EcdsaEthereum } from './ecdsa-credential.ts';
import { DynamicBytes, DynamicSHA3 } from '../dynamic.ts';
import { log } from '../credentials/dynamic-hash.ts';
import { owner } from '../../tests/test-utils.ts';

const EcdsaCredential = await EcdsaEthereum.Credential({
  maxMessageLength: 50,
});

// console.time('ecdsa constraints');
// let cs = await EcdsaCredential.program.analyzeMethods();
// console.log(cs.run.summary());
// console.timeEnd('ecdsa constraints');

// console.time('ecdsa compile');
// let vk = await EcdsaCredential.compile({ proofsEnabled: false });
// console.timeEnd('ecdsa compile');

// console.time('ecdsa dummy');
// let credDummy = await EcdsaCredential.dummy({
//   owner,
//   data: { message: 'test test' },
// });
// console.timeEnd('ecdsa dummy');

// create ecdsa cred from zkpass data

const schema = 'c7eab8b7d7e44b05b41b613fe548edf5';

const response = {
  taskId: '1582fa3c0e9747f0beebc0540052278d',
  publicFields: [],
  allocatorAddress: '0x19a567b3b212a5b35bA0E3B600FbEd5c2eE9083d',
  publicFieldsHash:
    '0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6',
  allocatorSignature:
    '0x84de522ac578d25a50e70b54f403dad02347679ddacb88974a37df758042fe441c8dc34869f2f05bd300062127e75d3b135147f890a704c9db6422607c0485ca1b',
  uHash: '0x2bed950239c116cecdbc4e65a16401c2f6c45cdf305bda5fe963ac8f1f1c51d0',
  validatorAddress: '0xb1C4C1E1Cdd5Cf69E27A3A08C8f51145c2E12C6a',
  validatorSignature:
    '0x99d61fa8f8413a3eaa38d2c064119c67592c696a0b8c2c2eb4a9b2e4ef122de3674e68203d0388d238635e36237f41279a406512515f6a26b0b38479d5c6eade1b',
};

type Type = 'bytes32' | 'address';

let { taskId, uHash, publicFieldsHash } = response;
let types: Type[] = ['bytes32', 'bytes32', 'bytes32', 'bytes32'];
let values = [
  Bytes.fromString(taskId),
  Bytes.fromString(schema),
  Bytes.fromHex(uHash),
  Bytes.fromHex(publicFieldsHash),
];

const DynBytes = DynamicBytes({ maxLength: 300 });

// compute message hash
let encodeParams = encodeParameters(types, values);
let messageHash = DynamicSHA3.keccak256(DynBytes.fromBytes(encodeParams));
log('messageHash', messageHash.toHex());

// Based on the Solidity ABI encoding we have the following definitions for encoding bytes32 and address
// For any ABI value X, we recursively define enc(X), depending on the type of X being
// bytes<M>: enc(X) is the sequence of bytes in X padded with trailing zero-bytes to a length of 32 bytes.
// address: as in the uint160 case
// uint<M>: enc(X) is the big-endian encoding of X, padded on the higher-order (left) side with zero-bytes such that the length is 32 bytes.
// https://docs.soliditylang.org/en/latest/abi-spec.html#formal-specification-of-the-encoding
function encodeParameters(types: Type[], values: Uint8Array[]) {
  let arrays = zip(types, values).map(([type, value]) => {
    if (type === 'bytes32') return Bytes.padEnd(value, 64, 0);
    if (type === 'address') return Bytes.padStart(value, 64, 0);
    throw Error('unexpected type');
  });
  return Bytes.concat(...arrays);
}
