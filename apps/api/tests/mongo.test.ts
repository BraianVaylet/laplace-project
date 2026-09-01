import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Prueba que el harness de integracion funciona: Mongo real en memoria y con
 * REPLICA SET, porque las transacciones (reserva + descuento de credito,
 * docs/adr/001-credit-consumption.md) no existen sin el.
 */
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_test' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const seatSchema = new mongoose.Schema({
  sessionId: String,
  taken: { type: Number, default: 0 },
  capacity: Number,
});
const Seat = mongoose.model('Seat', seatSchema);

describe('harness de integracion con Mongo', () => {
  it('conecta y persiste', async () => {
    const doc = await Seat.create({ sessionId: 'ses_1', capacity: 12 });
    const found = await Seat.findById(doc._id).lean();
    expect(found?.capacity).toBe(12);
  });

  it('soporta transacciones (requisito del replica set)', async () => {
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Seat.create([{ sessionId: 'ses_2', capacity: 8 }], { session });
    });
    await session.endSession();

    expect(await Seat.countDocuments({ sessionId: 'ses_2' })).toBe(1);
  });

  it('un update atomico condicionado no sobrevende el cupo', async () => {
    const doc = await Seat.create({ sessionId: 'ses_3', capacity: 1, taken: 0 });

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        Seat.updateOne({ _id: doc._id, taken: { $lt: 1 } }, { $inc: { taken: 1 } }),
      ),
    );

    const winners = attempts.filter((r) => r.modifiedCount === 1);
    expect(winners).toHaveLength(1);
    expect((await Seat.findById(doc._id).lean())?.taken).toBe(1);
  });
});
