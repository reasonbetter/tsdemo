const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Testing database connection...');
    
    // Count sessions
    const sessionCount = await prisma.session.count();
    console.log(`Total sessions: ${sessionCount}`);
    
    // Get a few sessions with their transcripts
    const sessions = await prisma.session.findMany({
      take: 3,
      orderBy: { updatedAt: 'desc' }
    });
    
    console.log(`\nFetched ${sessions.length} sessions:`);
    sessions.forEach((s, i) => {
      console.log(`\nSession ${i + 1}:`);
      console.log(`  ID: ${s.id}`);
      console.log(`  Updated: ${s.updatedAt}`);
      console.log(`  Transcript length: ${Array.isArray(s.transcript) ? s.transcript.length : 'not an array'}`);
      if (Array.isArray(s.transcript) && s.transcript.length > 0) {
        console.log(`  First transcript entry item_id: ${s.transcript[0]?.item_id}`);
      }
    });
    
    // Count log entries
    const logCount = await prisma.logEntry.count();
    console.log(`\n\nTotal LogEntry records: ${logCount}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
