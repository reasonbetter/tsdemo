// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

// Prevent multiple instances of Prisma Client in development due to hot-reloading
// See: https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Optional: uncomment the line below to see SQL queries in the console
    // log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
