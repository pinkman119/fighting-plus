const res = await fetch('http://127.0.0.1:3118/live/a286788dd3ea6b1d6c5bfb6d.flv');
console.log('status', res.status, 'ct', res.headers.get('content-type'));
const reader = res.body.getReader();
let total = 0;
let reads = 0;
while (total < 300000 && reads < 20) {
  const { value, done } = await reader.read();
  reads++;
  console.log('read', reads, 'done', done, 'len', value?.length ?? 0, 'total', total);
  if (done) break;
  total += value.length;
}
await reader.cancel();
console.log('final', { reads, total });
