// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

// Prevent multiple instances of Prisma Client in development due to hot-reloading
// Key the cache by DATABASE_URL so switching envs (Neon -> local) creates a new client.

const datasourceUrl = process.env.DATABASE_URL || "";

const globalForPrisma = globalThis as unknown as {
  prismaByUrl: Record<string, PrismaClient | undefined> | undefined;
};

if (!globalForPrisma.prismaByUrl) globalForPrisma.prismaByUrl = {};

export const prisma =
  globalForPrisma.prismaByUrl![datasourceUrl] ??
  new PrismaClient({
    // Optional: uncomment the line below to see SQL queries in the console
    // log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaByUrl![datasourceUrl] = prisma;
}
