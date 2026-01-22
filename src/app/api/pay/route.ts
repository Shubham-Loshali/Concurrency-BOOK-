import { NextResponse } from 'next/server';
import { getSeat, updateSeatStatus } from '@/lib/db';
import { redis } from '@/lib/redis';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { seatId, seatIds, userId } = body;

        // Normalize to array
        let targetSeatIds: string[] = [];
        if (seatIds && Array.isArray(seatIds)) {
            targetSeatIds = seatIds;
        } else if (seatId) {
            targetSeatIds = [seatId];
        }

        if (targetSeatIds.length === 0 || !userId) {
            return NextResponse.json(
                { error: 'Missing seatIds or userId' },
                { status: 400 }
            );
        }

        const seatsToBook = [];

        // 1. Validation Phase
        for (const id of targetSeatIds) {
            const seat = getSeat(id);
            if (!seat) {
                return NextResponse.json({ error: `Seat ${id} not found` }, { status: 404 });
            }
            if (seat.status === 'booked') {
                // Idempotency check: if all requested items are already booked by user, we can consider success
                // simplified: if any is booked by someone else, fail.
                if (seat.userId !== userId) {
                    return NextResponse.json({ error: `Seat ${id} is already booked` }, { status: 409 });
                }
            }
            seatsToBook.push(seat);
        }

        // 2. Lock Verification Phase
        const lockKeys = targetSeatIds.map(id => `lock:seat:${id}`);
        // If we are strictly checking active locks, we need to MGET
        // Note: If seat is already booked by user (idempotency), lock might be gone.
        // But for fresh booking, lock must exist.

        const currentLocks = await redis.mget(lockKeys);

        for (let i = 0; i < targetSeatIds.length; i++) {
            const seat = seatsToBook[i];
            // If already booked by us, skip lock check
            if (seat.status === 'booked' && seat.userId === userId) continue;

            const lockedBy = currentLocks[i];
            if (lockedBy !== userId) {
                return NextResponse.json(
                    { error: `Lock expired or seat ${targetSeatIds[i]} locked by another user` },
                    { status: 403 }
                );
            }
        }

        // Simulate payment delay once for the batch
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // 3. Execution Phase
        const pipe = redis.pipeline(); // For cleanup

        for (const id of targetSeatIds) {
            updateSeatStatus(id, 'booked', userId);
            pipe.del(`lock:seat:${id}`);
        }

        await pipe.exec();

        return NextResponse.json({ success: true, message: 'Booking confirmed' });
    } catch (error) {
        console.error('Error processing payment:', error);
        return NextResponse.json(
            { error: 'Payment failed' },
            { status: 500 }
        );
    }
}
