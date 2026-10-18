// The root account bootstraps a separate application account with access to zelo only.
const admin = db.getSiblingDB('admin');
if (!admin.auth('admin', process.env.MONGO_ROOT_PASSWORD)) throw new Error('Admin authentication failed');
const app = db.getSiblingDB('zelo');
if (!app.getUser('zelo')) {
  app.createUser({ user: 'zelo', pwd: process.env.MONGO_APP_PASSWORD, roles: [{ role: 'readWrite', db: 'zelo' }] });
}
// Fail explicitly if the env password changed without rotating the stored credential.
if (!app.auth('zelo', process.env.MONGO_APP_PASSWORD)) throw new Error('Application authentication failed');
