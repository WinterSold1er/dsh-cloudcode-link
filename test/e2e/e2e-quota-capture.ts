import fs from 'node:fs';
import path from 'node:path';
import { AccountPoolManager } from '../../packages/core/src/pool.ts';
import { QuotaService, agyUserAgent } from '../../packages/core/src/quota.ts';

const poolDir = path.join(process.env.HOME!, '.dsh/agy-accounts');
const pool = new AccountPoolManager(poolDir);
const quotaService = new QuotaService(pool);

async function main() {
  const accounts = pool.getAccounts();
  console.log(`Loaded ${accounts.length} accounts from ${poolDir}`);

  const evidence: Record<string, any> = {};

  for (const acc of accounts) {
    console.log(`\n========================================`);
    console.log(`Testing Account: ${acc.id} (${acc.email})`);
    console.log(`========================================`);

    const token = await quotaService.getValidAccessToken(acc);
    if (!token) {
      console.error(`Failed to get valid token for ${acc.id}`);
      continue;
    }

    const endpoints = [
      'https://daily-cloudcode-pa.googleapis.com',
      'https://cloudcode-pa.googleapis.com'
    ];

    evidence[acc.id] = {
      id: acc.id,
      email: acc.email,
      storedQuotas: acc.quotas,
      endpoints: {}
    };

    for (const ep of endpoints) {
      console.log(`\n--> Testing Endpoint: ${ep}`);
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': agyUserAgent()
      };

      // 1. retrieveUserQuotaSummary
      const urlQuota = `${ep}/v1internal:retrieveUserQuotaSummary`;
      let quotaRes;
      try {
        const res = await fetch(urlQuota, {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        });
        const resHeaders = Object.fromEntries(res.headers.entries());
        const bodyText = await res.text();
        let bodyJson;
        try { bodyJson = JSON.parse(bodyText); } catch { bodyJson = bodyText; }
        quotaRes = {
          url: urlQuota,
          status: res.status,
          statusText: res.statusText,
          headers: resHeaders,
          body: bodyJson
        };
      } catch (err) {
        quotaRes = { error: String(err) };
      }

      // 2. fetchAvailableModels
      const urlModels = `${ep}/v1internal:fetchAvailableModels`;
      let modelsRes;
      try {
        const res = await fetch(urlModels, {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        });
        const resHeaders = Object.fromEntries(res.headers.entries());
        const bodyText = await res.text();
        let bodyJson;
        try { bodyJson = JSON.parse(bodyText); } catch { bodyJson = bodyText; }
        modelsRes = {
          url: urlModels,
          status: res.status,
          statusText: res.statusText,
          headers: resHeaders,
          body: bodyJson
        };
      } catch (err) {
        modelsRes = { error: String(err) };
      }

      evidence[acc.id].endpoints[ep] = {
        quotaSummary: quotaRes,
        availableModels: modelsRes
      };

      console.log(`  retrieveUserQuotaSummary: status = ${quotaRes.status}`);
      if (quotaRes.status === 200) {
        console.log(`  Groups:`, JSON.stringify(quotaRes.body?.groups, null, 2));
      } else {
        console.log(`  Error body:`, JSON.stringify(quotaRes.body));
      }

      console.log(`  fetchAvailableModels: status = ${modelsRes.status}`);
      if (modelsRes.status === 200) {
        const modelKeys = Object.keys(modelsRes.body?.models || {});
        console.log(`  Available models count: ${modelKeys.length}`);
        const sample = modelKeys.slice(0, 5).map(k => ({
          modelId: k,
          displayName: modelsRes.body.models[k].displayName,
          quotaInfo: modelsRes.body.models[k].quotaInfo
        }));
        console.log(`  Sample models quotaInfo:`, JSON.stringify(sample, null, 2));
      } else {
        console.log(`  Error body:`, JSON.stringify(modelsRes.body));
      }
    }
  }

  fs.writeFileSync('research/reproduction/raw_upstream_dump_real.json', JSON.stringify(evidence, null, 2), 'utf8');
  console.log(`\nWrote complete raw data to research/reproduction/raw_upstream_dump_real.json`);
}

main().catch(console.error);
