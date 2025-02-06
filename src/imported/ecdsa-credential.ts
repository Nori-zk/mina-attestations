import {
  Bytes,
  createEcdsa,
  createForeignCurve,
  Crypto,
  EcdsaSignature,
  Experimental,
  Field,
  type From,
  Keccak,
  Provable,
  Struct,
  UInt8,
  Unconstrained,
  ZkProgram,
} from 'o1js';
import { Credential } from '../credential-index.ts';
import { DynamicArray, DynamicBytes, DynamicSHA3 } from '../dynamic.ts';
import { bytesToBigintBE } from '../rsa/utils.ts';
import { assert, ByteUtils } from '../util.ts';
import { unpackBytes } from '../credentials/gadgets.ts';

export {
  EcdsaEthereum,
  parseSignature,
  recoverPublicKey,
  publicKeyToAddress,
  verifyEthereumSignatureSimple,
  getHashHelper,
};

class PublicKey extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}
class Signature extends createEcdsa(PublicKey) {}

const MessageHash = Bytes(32);
const Address = Bytes(20);

const EcdsaEthereum = {
  Signature,
  PublicKey,
  MessageHash,
  Address,
  Credential: EcdsaCredential,
  compileDependencies,
};

// Ethereum signed message hash (EIP-191), assuming a 32-byte message that resulted from another hash
const MESSAGE_PREFIX = '\x19Ethereum Signed Message:\n32';

async function compileDependencies({
  maxMessageLength,
}: {
  maxMessageLength: number;
}) {
  await getHashHelper(maxMessageLength).compile();
}

async function EcdsaCredential({
  maxMessageLength,
}: {
  maxMessageLength: number;
}) {
  const Message = DynamicBytes({ maxLength: maxMessageLength });

  const hashHelper = getHashHelper(maxMessageLength);
  const hashHelperRecursive = Experimental.Recursive(hashHelper);

  return Credential.Recursive.fromMethod(
    {
      name: `ecdsa-${maxMessageLength}`,
      publicInput: { signerAddress: Address },
      privateInput: {
        message: Message,
        signature: Signature,
        parityBit: Unconstrained.withEmpty(false),
      },
      data: { message: Message },
    },
    async ({
      publicInput: { signerAddress: address },
      privateInput: { message, signature, parityBit },
    }) => {
      // in a recursive call, hash the message and extract the public key
      let { messageHash, publicKey } = await hashHelperRecursive.short({
        message,
        signature,
        address,
        parityBit,
      });

      // verify the signature against the now-validated public key
      let ok = signature.verifySignedHash(messageHash, publicKey);
      ok.assertTrue('signature is invalid');
      return { message };
    }
  );
}

/**
 * Non-recursive e2e signature verification, for benchmarking and testing.
 *
 * Note: this is not provable due to the circuit limit, use the recursive version for that.
 */
function verifyEthereumSignatureSimple(
  message: DynamicArray<UInt8> | string | Uint8Array,
  signature: From<typeof Signature>,
  address: Bytes | Uint8Array,
  parityBit: Unconstrained<boolean> | boolean
) {
  message = DynamicBytes.from(message);
  signature = Signature.from(signature);
  address = Bytes.from(address);
  parityBit = Unconstrained.from(parityBit);

  // hash the message
  let messageHash = DynamicSHA3.keccak256(message);
  let finalHash = Keccak.ethereum([
    ...Bytes.fromString(MESSAGE_PREFIX).bytes,
    ...messageHash.bytes,
  ]);

  // witness the recovered public key
  let publicKey = Provable.witness(PublicKey, () =>
    recoverPublicKey(finalHash, signature, parityBit.get())
  );

  // check that public key hashes to address
  let recoveredAddress = publicKeyToAddress(publicKey);
  Provable.assertEqual(Address, recoveredAddress, address);

  // verify the signature against the now-validated public key
  let ok = signature.verifySignedHash(finalHash, publicKey);
  ok.assertTrue('signature is invalid');
}

// helper functions

function publicKeyToAddress(pk: From<typeof PublicKey>) {
  let { x, y } = PublicKey.from(pk);

  // convert both x and y to 32-byte big-endian integers
  let xBytes = foreignFieldToBytes32BE(x);
  let yBytes = foreignFieldToBytes32BE(y);

  // hash the concatenation of x and y
  // and take the last 20 bytes as the address
  let pkHash = Keccak.ethereum([...xBytes, ...yBytes]);
  return Address.from(pkHash.bytes.slice(-20));
}

/**
 * Convert 3x88-bit foreign field to 32 big-endian bytes.
 * Asserts that the 33th byte is zero.
 */
function foreignFieldToBytes32BE(field: { value: [Field, Field, Field] }) {
  let [x0, x1, x2] = field.value;
  let bytes0 = unpackBytes(x0, 11);
  let bytes1 = unpackBytes(x1, 11);
  let bytes2 = unpackBytes(x2, 11);
  let extraByte = bytes2.pop()!;
  extraByte.assertEquals(0, 'Foreign field exceeds 32 bytes');
  // since big-endian is expected, we reverse the bytes
  return [...bytes0, ...bytes1, ...bytes2].reverse();
}

/**
 * Recover the implied public key from a message hash, signature and a parity bit.
 */
function recoverPublicKey(
  messageHash: Bytes | Uint8Array,
  signature: From<typeof EcdsaSignature>,
  isOdd: boolean
) {
  let {
    Scalar: { Bigint: Scalar },
    Field: { Bigint: Field },
    Bigint: Curve,
  } = EcdsaEthereum.PublicKey;

  // read inputs
  if (messageHash instanceof Bytes.Base) messageHash = messageHash.toBytes();
  if (!(signature instanceof EcdsaEthereum.Signature))
    signature = EcdsaEthereum.Signature.from(signature);

  let m = Scalar.mod(bytesToBigintBE(messageHash));
  let r = signature.r.toBigInt();
  let s = signature.s.toBigInt();

  // first, recover R_y from R_x and parity
  let x = Field.mod(r);
  let x3 = Field.mul(x, Field.square(x));
  let y2 = Field.add(x3, Field.mul(Curve.a, x) + Curve.b);
  let y = Field.sqrt(y2);
  assert(y !== undefined);
  if (Field.isEven(y) !== !isOdd) y = Field.negate(y);
  let R = { x, y, infinity: false };

  // recover public key
  let rInv = Scalar.inverse(r);
  assert(rInv !== undefined);

  let publicKey = Curve.sub(
    Curve.scale(R, Scalar.mul(s, rInv)),
    Curve.scale(Curve.one, Scalar.mul(m, rInv))
  );
  assert(publicKey.infinity === false);
  return publicKey;
}

/**
 * Input can be a hex string or a Uint8Array.
 */
function parseSignature(signature: string | Uint8Array) {
  if (typeof signature === 'string') signature = ByteUtils.fromHex(signature);
  assert(signature.length === 65);

  let r = bytesToBigintBE(signature.slice(0, 32));
  let s = bytesToBigintBE(signature.slice(32, 64));
  let v = signature[64]!;
  assert(v === 27 || v === 28, `Invalid recovery id "v" ${v}`);

  // Convert v to parity of R_y (27/28 -> 0/1 -> boolean)
  let isOdd = !!(v - 27);
  return { signature: { r, s }, isOdd };
}

/*
RECURSIVE PROOF SPLITTING

there are two versions, an easy one that only supports messages up to a few keccak blocks,
and a flexible and more complex one.

VERSION 1:

(main) ---- (hash address, message hash and message)

VERSION 2, with two recursive branches:

(main) ---- (hash address, message hash and message)
       \--- (hash address, message hash and end of message) --> (recursive message hash)
*/

const hashHelpers = new Map<number, ReturnType<typeof createHashHelper>>();

function getHashHelper(maxMessageLength: number) {
  if (!hashHelpers.has(maxMessageLength)) {
    hashHelpers.set(maxMessageLength, createHashHelper(maxMessageLength));
  }
  return hashHelpers.get(maxMessageLength)!;
}

function createHashHelper(maxMessageLength: number) {
  const Message = DynamicBytes({ maxLength: maxMessageLength });

  class HashHelperInput extends Struct({
    message: Message,
    signature: Signature,
    address: Address,
    parityBit: Unconstrained.withEmpty(false),
  }) {}
  class HashHelperOutput extends Struct({
    messageHash: MessageHash,
    publicKey: PublicKey,
  }) {}

  let hashHelperProgram = ZkProgram({
    name: 'ecdsa-hash-helper',
    publicInput: HashHelperInput,
    publicOutput: HashHelperOutput,

    methods: {
      short: {
        privateInputs: [],
        async method({
          message,
          signature,
          address,
          parityBit,
        }: HashHelperInput) {
          let intermediateHash = DynamicSHA3.keccak256(message);
          let messageHash = Keccak.ethereum([
            ...Bytes.fromString(MESSAGE_PREFIX).bytes,
            ...intermediateHash.bytes,
          ]);

          // witness the recovered public key
          let publicKey = Provable.witness(PublicKey, () =>
            recoverPublicKey(messageHash, signature, parityBit.get())
          );

          // check that public key hashes to address
          let recoveredAddress = publicKeyToAddress(publicKey);
          Provable.assertEqual(Address, recoveredAddress, address);

          let publicOutput = { messageHash, publicKey };
          return { publicOutput };
        },
      },
    },
  });

  return hashHelperProgram;
}
