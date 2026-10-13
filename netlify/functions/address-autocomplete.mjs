const response = (statusCode, body) => ({statusCode, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(body)});
export async function handler(event) {
  if (event.httpMethod !== 'GET') return response(405,{suggestions:[]});
  const query = String(event.queryStringParameters?.q || '').trim();
  if (query.length < 3 || query.length > 200) return response(200,{suggestions:[]});
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return response(503,{suggestions:[],error:'Address lookup unavailable'});
  try {
    const google = await fetch('https://places.googleapis.com/v1/places:autocomplete',{
      method:'POST',signal:AbortSignal.timeout(8000),
      headers:{'content-type':'application/json','X-Goog-Api-Key':apiKey},
      body:JSON.stringify({input:query,includedRegionCodes:['us'],locationBias:{circle:{center:{latitude:41.2,longitude:-80.8},radius:50000}}})
    });
    if (!google.ok) return response(502,{suggestions:[],error:'Address lookup unavailable'});
    const data = await google.json();
    return response(200,{suggestions:[...new Set((data.suggestions || []).map(item=>item.placePrediction?.text?.text).filter(Boolean))].slice(0,6)});
  } catch {return response(502,{suggestions:[],error:'Address lookup unavailable'});}
}
