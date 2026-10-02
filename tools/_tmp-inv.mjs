const d = await (await fetch('http://127.0.0.1:8094/af/save?uid=' + process.argv[2] + '&token=' + process.argv[3])).json();
const kn = (d.datas || []).find(x => x.key === 'knapData_' + process.argv[2])?.val;
console.log('uid', process.argv[2], 'knapData:', JSON.stringify(kn));
