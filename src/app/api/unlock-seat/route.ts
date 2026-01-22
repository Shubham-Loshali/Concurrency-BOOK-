import { NextResponse } from 'next/server';
import { getSeat } from '@/lib/db';
import { redis } from '@/lib/redis';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { seatId, userId } = body;

        if (!seatId || !userId) {
            return NextResponse.json(
                { error: 'Missing seatId or userId' },
                { status: 400 }
            );
        }

        const seat = getSeat(seatId);
        if (!seat) {
            return NextResponse.json(
                { error: 'Seat not found' },
                { status: 404 }
            );
        }

        // Verify lock ownership
        const lockKey = `lock:seat:${seatId}`;
        const lockedBy = await redis.get(lockKey);

        if (lockedBy && lockedBy !== userId) {
            return NextResponse.json(
                { error: 'Seat is locked by another user' },
                { status: 403 }
            );
        }

        if (!lockedBy) {
            // Already unlocked, technically success for this operation
            return NextResponse.json({ success: true, message: 'Seat already unlocked' });
        }

        // Remove lock
        await redis.del(lockKey);

        return NextResponse.json({ success: true, message: 'Seat unlocked' });
    } catch (error) {
        console.error('Error unlocking seat:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
