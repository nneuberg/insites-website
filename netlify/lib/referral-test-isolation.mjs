// LOCAL CANDIDATE ONLY. A future test requires its separately reviewed manifest.
// Never exempt a row merely because its name/id looks synthetic.
const RUN='synthetic-referral-qualification-20261027-v3';
const IDS=new Set(['same-a','same-b','different','first-seen'].map(s=>RUN+'-'+s));
export function isOwnedSyntheticInspection(id,snapshot){
 if(!IDS.has(id)||!Array.isArray(snapshot?.uses)||!Array.isArray(snapshot?.codes))return false;
 const uses=snapshot.uses.filter(r=>r['Hive Inspection ID']===id);
 if(uses.length!==1)return false;
 const r=uses[0];
 if(r['Use ID']!=='HIVE-'+id||r.Notes!==RUN||r.Code!=='SYNTHETIC-QUALIFICATION-V3'||r['Referrer Email']!=='owner@example.invalid'||r['Client ID']!=='synthetic-contact-'+id.slice(RUN.length+1))return false;
 const codes=snapshot.codes.filter(c=>c.Code===r.Code);
 return codes.length===1&&codes[0]['Referrer Email']==='owner@example.invalid'&&codes[0].Notes===RUN&&codes[0]['Assignment State']==='ASSIGNED'&&codes[0]['Hive State']==='VERIFIED'&&!codes[0]['Referrer ID'];
}
