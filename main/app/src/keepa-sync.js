import fs from 'fs';

const DATA_DIR = '/opt/alh/data';
const CREDS_FILE = `${DATA_DIR}/credentials.json`;
const LISTINGS_FILE = `${DATA_DIR}/listings.json`;
const KEEPA_FILE = `${DATA_DIR}/keepa.json`;

async function syncKeepa() {
  const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  const listings = JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf8'));
  
  const asins = [...new Set(listings.items.map(i => i.asin).filter(a => a))];
  console.log(`Syncing ${asins.length} ASINs...`);
  
  let keepaData = {};

  const batchSize = 50;
  for (let i = 0; i < asins.length; i += batchSize) {
    const batch = asins.slice(i, i + batchSize);
    console.log(`Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(asins.length/batchSize)}: ${batch.length} ASINs`);
    
    const url = `https://api.keepa.com/product?key=${creds.keepaKey}&domain=2&asin=${batch.join(',')}&stats=180&offers=20`;
    
    try {
      const res = await fetch(url);
      const data = await res.json();
      
      console.log(`Tokens remaining: ${data.tokensLeft}`);
      
      if (data.products) {
        data.products.forEach(p => {
          keepaData[p.asin] = {
            salesRank: p.stats?.current?.[3],
            buyBoxPrice: p.stats?.current?.[18] ? p.stats.current[18] / 100 : null,
            newOfferCount: p.stats?.current?.[11],
            rating: p.stats?.current?.[16] ? p.stats.current[16] / 10 : null,
            reviewCount: p.stats?.current?.[17],
            competitorCount: (p.offers || []).filter(o => o.condition === 1).length
          };
        });
      }
      
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error('Keepa error:', e.message);
    }
  }
  
  fs.writeFileSync(KEEPA_FILE, JSON.stringify({ data: keepaData, lastSync: new Date().toISOString() }, null, 2));
  console.log(`Done! Synced ${Object.keys(keepaData).length} products`);
}

syncKeepa();
