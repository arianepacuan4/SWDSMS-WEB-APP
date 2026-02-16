require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';
if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE)) {
  console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE in your .env before running this script.');
  process.exit(1);
}

// prefer service_role key for migration (bypass RLS if present)
const clientKey = SUPABASE_SERVICE_ROLE || SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, clientKey);
const usersFile = path.join(__dirname, 'data', 'users.json');

async function run() {
  if (!fs.existsSync(usersFile)) {
    console.error('No local users.json file found.');
    process.exit(1);
  }

  const users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || [];
  if (!users.length) {
    console.log('No users to migrate.');
    return;
  }

  console.log(`Migrating ${users.length} users to Supabase (table: public.users)`);

  for (const u of users) {
    try {
      const payload = {
        full_name: u.fullName || u.full_name || '',
        username: u.username,
        email: u.email,
        account_type: u.accountType || u.account_type || 'Student',
        password: u.password || u.pw || ''
      };

      const { data, error } = await supabase.from('users').insert([payload]).select();
      if (error) {
        console.error('Failed to insert', u.username, error.message || error);
      } else {
        console.log('Inserted', data[0].username, 'id=', data[0].id);
      }
    } catch (err) {
      console.error('Unexpected error for', u.username, err.message || err);
    }
  }

  // migrate reports.json -> public.reports
  const reportsFile = path.join(__dirname, 'data', 'reports.json');
  if (fs.existsSync(reportsFile)) {
    const reports = JSON.parse(fs.readFileSync(reportsFile, 'utf8')) || [];
    console.log(`Migrating ${reports.length} reports to Supabase (table: public.reports)`);

    for (const r of reports) {
      try {
        const payload = {
          name: r.name || null,
          grade: r.grade || null,
          type: r.type,
          description: r.description,
          incident_date: r.date
        };

        const { data, error } = await supabase.from('reports').insert([payload]).select();
        if (error) {
          console.error('Failed to insert report', r.id || '', error.message || error);
        } else {
          console.log('Inserted report id=', data[0].id);
        }
      } catch (err) {
        console.error('Unexpected error for report', r.id || '', err.message || err);
      }
    }
  } else {
    console.log('No local reports.json found to migrate.');
  }

  console.log('Migration finished. Verify rows in Supabase SQL editor or Table view.');
}

run();