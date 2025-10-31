const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { 
      transcript: { 
        not: { equals: [] }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });
  
  if (session && session.transcript) {
    console.log('Transcript structure:');
    console.log(JSON.stringify(session.transcript, null, 2));
  } else {
    console.log('No sessions with transcript data found');
  }
  await prisma.$disconnect();
}

main();
