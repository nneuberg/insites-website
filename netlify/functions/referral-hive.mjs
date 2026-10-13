import {hiveRollout, runHiveReferrals} from '../lib/referral-hive.mjs';

// No key, store, or production ledger is accessed while disabled or in previews.
export default async (_request, context) => {
  const deployment = context?.deploy?.context || process.env.CONTEXT || 'local';
  const paused = hiveRollout(process.env, deployment);
  if (paused) return Response.json(paused);
  const {getStore} = await import('@netlify/blobs');
  const store = getStore({name: 'insites-referral-hive-production', consistency: 'strong'});
  return Response.json(await runHiveReferrals({store, context: deployment}));
};
export const config = {schedule: '*/15 * * * *'};
