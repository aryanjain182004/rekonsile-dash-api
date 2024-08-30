import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateUsers() {
    const result = await prisma.user.updateMany({
        data: {
            businessName: "",
            phoneNumber: ""
        },
        where: {},
    });

    console.log(`${result.count} users data migrated successfully.`);
}

updateUsers()
  .catch(e => {
    console.error("error while migrating user data", e);
  })