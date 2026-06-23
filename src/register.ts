import { registerMetadataSchema } from './discord.js';

try {
  const data = await registerMetadataSchema();
  console.log(data);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
