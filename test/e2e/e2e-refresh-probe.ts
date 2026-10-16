import fs from 'node:fs';
import path from 'node:path';
import { AccountPoolManager } from '../../packages/core/src/pool.ts';
import { QuotaService, agyUserAgent } from '../../packages/core/src/quota.ts';

const poolDir = path.join(process.env.HOME!, '.dsh/agy-accounts');
const pool = new AccountPoolManager(poolDir);
const quotaService = new QuotaService(pool);

async function checkAccount(accId: string, endpoint: string) {
  const acc = pool.getAccount(accId);
  if (!acc) return null;
  const token = await quotaService.getValidAccessToken(acc);
  if (!token) return null;

  const url = `${endpoint}/v1internal:retrieveUserQuotaSummary`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': agyUserAgent()
    },
    body: JSON.stringify({})
  });
  const data = (await res.json()) as any;
  return data;
}

async function main() {
  const accId = 'acc_1788785623927_xhs7n';
  console.log(`Querying ${accId} on daily-cloudcode-pa (Pass 1)...`);
  const daily1 = await checkAccount(accId, 'https://daily-cloudcode-pa.googleapis.com');
  console.log('Daily Pass 1 groups:', JSON.stringify(daily1?.groups?.map((g: any) => ({ name: g.displayName, buckets: g.buckets })), null, 2));

  console.log(`\nQuerying ${accId} on cloudcode-pa (Pass 1)...`);
  const prod1 = await checkAccount(accId, 'https://cloudcode-pa.googleapis.com');
  console.log('Prod Pass 1 groups:', JSON.stringify(prod1?.groups?.map((g: any) => ({ name: g.displayName, buckets: g.buckets })), null, 2));

  console.log(`\nWaiting 3 seconds...`);
  await new Promise(r => setTimeout(r, 3000));

  console.log(`\nQuerying ${accId} on cloudcode-pa (Pass 2)...`);
  const prod2 = await checkAccount(accId, 'https://cloudcode-pa.googleapis.com');
  console.log('Prod Pass 2 groups:', JSON.stringify(prod2?.groups?.map((g: any) => ({ name: g.displayName, buckets: g.buckets })), null, 2));
}

main().catch(console.error);
