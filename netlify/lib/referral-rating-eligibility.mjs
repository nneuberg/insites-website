// Read only the exact review request's persisted, validated rating evidence.
// A Google-reviewed tag, a clicked star link, or absent feedback is not a rating.
export const REFERRAL_RATING_POLICY='referral-positive-rating-v1';
const GOOGLE_STARS=Object.freeze({ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5});
const validTime=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now;
export function referralRatingEligibility(row,now=Date.now()){
 const deny=reason=>({eligible:false,reason});
 if(!row||typeof row.token!=='string'||!row.token||!Number.isSafeInteger(now))return deny('rating_identity_unknown');
 const ratings=[];let observedAt=now;
 if(row.ratedAt!==undefined&&row.ratedAt!==null){
  if(!validTime(row.ratedAt,now)||!Number.isInteger(row.rating)||row.rating<1||row.rating>5||row.feedbackUpdatedAt!==undefined&&(!validTime(row.feedbackUpdatedAt,now)||row.feedbackUpdatedAt<row.ratedAt)||row.feedbackRevision!==undefined&&(!Number.isSafeInteger(row.feedbackRevision)||row.feedbackRevision<1))return deny('private_rating_unverified');
  ratings.push({source:'private_feedback',stars:row.rating,recordedAt:row.feedbackUpdatedAt??row.ratedAt,revision:row.feedbackRevision??1});
 }else if(['rating','feedbackRevision','feedbackUpdatedAt'].some(k=>row[k]!==undefined&&row[k]!==null))return deny('private_rating_unverified');
 if(['googleReviewedAt','googleReviewId','googleReview','googleReviewObservedAt'].some(k=>row[k]!==undefined&&row[k]!==null)){
  const review=row.googleReview,stars=typeof review?.starRating==='string'&&Object.hasOwn(GOOGLE_STARS,review.starRating)?GOOGLE_STARS[review.starRating]:null;
  if(!validTime(row.googleReviewedAt,now)||typeof row.googleReviewId!=='string'||!row.googleReviewId||review?.reviewId!==row.googleReviewId||![1,2,3,4,5].includes(stars)||row.googleReviewSource!=='google_reviews_get'||!validTime(row.googleReviewObservedAt,now)||now-row.googleReviewObservedAt>60000)return deny('google_rating_unverified');
  ratings.push({source:'confirmed_google_review',stars,recordedAt:row.googleReviewedAt,reviewId:row.googleReviewId});
  observedAt=Math.min(observedAt,row.googleReviewObservedAt);
 }
 if(!ratings.length)return deny('rating_missing');
 // Conflicting sources do not silently let a positive rating override a negative one.
 if(ratings.some(x=>x.stars<4))return deny('rating_below_four');
 return{eligible:true,proof:{version:REFERRAL_RATING_POLICY,verified:true,token:row.token,minimumStars:4,observedAt,ratings}};
}
