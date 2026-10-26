// Never permit this test-only tree to become a production deployment.
if(process.env.CONTEXT!=='deploy-preview')throw Error('Only a Git Deploy Preview may build this artifact');
console.log('Synthetic claim-storage preview; no provider transports or schedules.');
