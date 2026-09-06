const axios = require('axios');
axios.post('http://localhost:3000/api/approval-lines', {
  deptName: "재정부",
  lines: [
    { approverUserId: "test1" }
  ]
}).then(console.log).catch(err => console.error(err.response?.data));
