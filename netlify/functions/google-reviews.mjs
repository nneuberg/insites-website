export default async () => {
  const apiKey=Netlify.env.get('GOOGLE_PLACES_API_KEY');
  const placeId=Netlify.env.get('GOOGLE_PLACE_ID');
  const headers={'content-type':'application/json','cache-control':'public, max-age=0, s-maxage=3600'};
  if(!apiKey||!placeId)return new Response(JSON.stringify({connected:false}),{status:503,headers});
  try{
    const response=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,{headers:{'X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'rating,userRatingCount,googleMapsUri,reviews.authorAttribution,reviews.rating,reviews.text,reviews.originalText,reviews.relativePublishTimeDescription,reviews.googleMapsUri'}});
    if(!response.ok)throw new Error(`Google Places returned ${response.status}`);
    const place=await response.json();
    const reviews=(place.reviews??[]).filter((review)=>review.text?.text||review.originalText?.text).map((review)=>({authorName:review.authorAttribution?.displayName??'Google reviewer',authorUri:review.authorAttribution?.uri,authorPhotoUri:review.authorAttribution?.photoUri,rating:review.rating??5,text:review.text?.text??review.originalText?.text??'',relativeDate:review.relativePublishTimeDescription??'Google review',googleMapsUri:review.googleMapsUri??place.googleMapsUri??'https://www.google.com/maps'}));
    return new Response(JSON.stringify({connected:true,rating:place.rating??5,reviewCount:place.userRatingCount??reviews.length,placeId,googleMapsUri:place.googleMapsUri,reviews}),{headers});
  }catch{return new Response(JSON.stringify({connected:false}),{status:502,headers});}
};
 
