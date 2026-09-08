#!/usr/bin/env node
// Who took part in the four-day auction, and what they are getting.
//
//   node tools/auction.mjs
//
// WHAT CAN AND CANNOT BE READ OFF THE CHAIN
//
// The deposits themselves are invisible from here. They were plain ETH sent to
// the launchpad, and a plain ETH transfer emits no log, so eth_getLogs cannot
// see one — and the explorer's API sits behind Cloudflare. The launchpad's own
// events turned out to be per-TOKEN, not per-buyer: the factory hosts many
// launches and its logs say nothing about who bought what.
//
// What IS visible is the other end. Every participant's tokens sit in the
// escrow and come out on a vest, so every claim is a Transfer out of it, and
// every participant eventually appears. That gives the wallets, what they have
// taken, and — because the vest is linear and its window is known — a good
// estimate of what each is owed in total:
//
//     allocation ~= claimed / (fraction of the vest unlocked when they claimed)
//
// THE ASSUMPTION, STATED: that a wallet claimed everything available to it.
// Somebody who claimed only part of their unlocked amount will read LOW here.
// The estimate is checkable against a number we know exactly — the pool is
// 400,000,000 — and the wallets below add up to 96% of it, which is what makes
// it worth printing at all rather than a guess with decimal places on it.
//
// A wallet that has never claimed is invisible. The gap at the bottom is the
// honest size of what this cannot see.
import { createPublicClient, http, defineChain, formatUnits, getAddress } from 'viem';
const RPC = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const chain=defineChain({id:4663,name:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[RPC]}}});
const pub=createPublicClient({chain,transport:http(RPC)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function retry(fn,w){for(let i=0;i<7;i++){try{return await fn()}catch(e){await sleep(700*2**i); if(i===6) throw new Error(w+': '+(e.shortMessage||e.message))}}}
const T='0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A', F='0xE4AcdB51b6554246Da8488d1e68E8FAd1b93f383';
const LP='0xeb0226f992F959b7fA2ac7c3DAfc712915310FEa';
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad=a=>'0x'+a.toLowerCase().replace(/^0x/,'').padStart(64,'0');

const head=await retry(()=>pub.getBlockNumber(),'head');
const logs=[];
for(let f=56600000n; f<=head; f+=400000n){
  const t=f+399999n>head?head:f+399999n;
  logs.push(...await retry(()=>pub.request({method:'eth_getLogs',params:[{address:T,fromBlock:'0x'+f.toString(16),toBlock:'0x'+t.toString(16),topics:[TRANSFER,pad(F)]}]}),'x'));
  await sleep(300);
}
// block timestamps, one call per distinct block
const blocks=[...new Set(logs.map(l=>Number(BigInt(l.blockNumber))))].sort((a,b)=>a-b);
const ts=new Map();
for(const b of blocks){ const blk=await retry(()=>pub.getBlock({blockNumber:BigInt(b)}),'blk'); ts.set(b, Number(blk.timestamp)); await sleep(220); }
const nowBlk=await retry(()=>pub.getBlock({blockNumber:head}),'now'); const now=Number(nowBlk.timestamp);

const settleBlk=blocks[0], settleTs=ts.get(settleBlk);
const VEST_DAYS=30, vestEnd=settleTs+VEST_DAYS*86400;
const frac=t=>Math.max(0,Math.min(1,(t-settleTs)/(vestEnd-settleTs)));

const who=new Map();
for(const l of logs){
  const to=getAddress('0x'+l.topics[2].slice(26));
  if(to.toLowerCase()===LP.toLowerCase()) continue;
  const v=BigInt(l.data), b=Number(BigInt(l.blockNumber));
  const r=who.get(to)??{got:0n,n:0,last:0};
  r.got+=v; r.n++; r.last=Math.max(r.last,b); who.set(to,r);
}
const rows=[...who].sort((a,b)=>b[1].got>a[1].got?1:-1);
const claimed=rows.reduce((n,[,r])=>n+r.got,0n);
const held=await retry(()=>pub.readContract({address:T,abi:[{name:'balanceOf',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}],functionName:'balanceOf',args:[F]}),'bal');
const pool = claimed + held;
const fmt=v=>Number(formatUnits(v,18)).toLocaleString('en-GB',{maximumFractionDigits:0});
const d=t=>new Date(t*1000).toISOString().replace('T',' ').slice(0,16)+' UTC';

console.log(`settle          block ${settleBlk}   ${d(settleTs)}`);
console.log(`vest ends       ${d(vestEnd)}   (${VEST_DAYS} days)`);
console.log(`now             ${d(now)}   ->  ${(frac(now)*100).toFixed(2)}% of the vest has unlocked`);
console.log('');
console.log(`auction pool    ${fmt(pool).padStart(13)} KEVIN   (claimed ${fmt(claimed)} + still in escrow ${fmt(held)})`);
console.log(`claimed so far  ${fmt(claimed).padStart(13)} KEVIN   = ${(Number(claimed)/Number(pool)*100).toFixed(2)}% of the pool`);
console.log(`wallets claimed ${String(rows.length).padStart(13)}`);
console.log('');
console.log('wallet                                        claimed        est. TOTAL allocation   claims  last claim');
for(const [a,r] of rows){
  const f=frac(ts.get(r.last));
  const est=f>0.001? BigInt(Math.round(Number(r.got)/f)) : 0n;
  console.log(`  ${a}  ${fmt(r.got).padStart(11)}  ${(f>0.001?fmt(est):'?').padStart(13)}   (${(f*100).toFixed(1)}% unlocked)  ${r.n}  ${d(ts.get(r.last)).slice(0,10)}`);
}
const estTotal=rows.reduce((n,[,r])=>{const f=frac(ts.get(r.last)); return n + (f>0.001? Number(r.got)/f : 0);},0);
console.log('');
console.log(`estimated allocation of the wallets that have claimed: ${Math.round(estTotal/1e18).toLocaleString('en-GB')} KEVIN`);
console.log(`  = ${(estTotal/Number(pool)*100).toFixed(1)}% of the auction pool`);
console.log(`unaccounted (wallets that have not claimed yet):        ${fmt(pool - BigInt(Math.round(estTotal)))} KEVIN`);
