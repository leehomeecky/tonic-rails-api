// Imported first by generate-openapi.ts: env validation runs when AppModule is
// imported, and these placeholders satisfy it (nothing connects in preview mode).
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: process.env.DB_HOST ?? 'unused',
  DB_USER: process.env.DB_USER ?? 'unused',
  DB_PASSWORD: process.env.DB_PASSWORD ?? 'unused',
  DB_NAME: process.env.DB_NAME ?? 'unused',
});
