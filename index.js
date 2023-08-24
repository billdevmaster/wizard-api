const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const mysql = require('mysql');
const cors = require('cors');
const Web3 = require('web3');
const axios = require('axios');
require('dotenv').config();
const app = express();
const tokenAddress = "0xC3Df0c5405315A708176d1828F80C77f80f5DC7c";
const adminAddress = "0x911a7F0f80d7A509C31445fD108C4D0c86bd66eF";
const web3 = new Web3(new Web3.providers.HttpProvider("https://optimism-mainnet.public.blastapi.io"));
const tokenABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];
const contractInstance = new web3.eth.Contract(tokenABI, tokenAddress);
const secretEncryptionKey = process.env.secretKey;
const configuration = {
  host: process.env.host,
  user: process.env.user,
  password: process.env.password,
  database: process.env.database,
  acquireTimeout: 10000000000
};
const rate = 1; // 1 credit = 4 tokens
let connection;


handleDisconnect();

app.use(bodyParser.json());
app.use(cors({ origin: '*' }));
// Define a route
app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.get('/getUserCredit', (req, res) => {
  try {
    const address = req.query.address;
    const sql = `SELECT * FROM user_credit WHERE address='${address}'`;
    connection.query(sql, (err, result) => {
      if (err) throw err;
      if (result.length > 0) {
        let retData = {...result[0], rate};
        res.json(retData);
      } else {
        res.json({
          rate,
          credits: 0
        });
      }
    })
  } catch (e) {
    console.log(e)
  }
});

app.post('/minusUserCredit', async (req, res) => {
  try {
    const address = req.query.address;
    sql = `UPDATE user_credit SET credits=credits - 1 WHERE address='${address.toLowerCase()}'`;
    connection.query(sql, (err, result) => {
      if (err) {
        res.json({status: "fail"});
      } else {
        res.json({status: "success"});
      }
    })
  } catch (e) {
    console.log(e)    
  }
});

// Start the server
app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});

function hashString(input) {
  const sha256 = crypto.createHash('sha256');
  sha256.update(input, 'utf8');
  return sha256.digest('hex');
}

function handleDisconnect() {
  connection = mysql.createConnection(configuration);

  connection.connect(function(err) {
    if (err) {
      console.log("error when connecting to db:", err);
      setTimeout(handleDisconnect, 2000);
    }else{
        console.log("connection is successfull");
    }
  });
  connection.on("error", function(err) {
    console.log("db error", err);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

async function detectTransactions() {
  
  let lastBlock = await web3.eth.getBlockNumber();
  console.log(lastBlock);
  while(true) {
    try {
      const resp = await axios.get(`https://api-optimistic.etherscan.io/api?module=logs&action=getLogs&fromBlock=${lastBlock + 1}&address=${tokenAddress}&apikey=YM1HAEMC4GCCASJKHUF49VYRJV5GZ5Y7N3`);
      if (resp.data.result?.length > 0) {
        for (let i = 0; i < resp.data.result.length; i++) {
          const trxHash = resp.data.result[i].transactionHash;
          const transaction = await web3.eth.getTransaction(trxHash);
          const input = transaction.input;

          if (input.slice(0, 10) === '0xa9059cbb' && transaction.to.toLowerCase() == tokenAddress.toLowerCase()) { // transfer function
            const recipient = '0x' + input.slice(34, 74);
            const from = transaction.from;
            const amount = web3.utils.toBN('0x' + input.slice(74));
            const addedCreditAmount = web3.utils.fromWei(amount, "ether") * (1 / rate);
            
            let sql = "";
            let address = "";
            let type = "";
            if (recipient.toLowerCase() == adminAddress.toLowerCase()) { // buy coins
              address = from.toLowerCase();
              type = "buy";
              sql = `SELECT * FROM user_credit WHERE address='${from.toLowerCase()}'`;
              connection.query(sql, (err1, result1) => {
                console.log(err1)
                console.log(result1)
                if (err1) throw err1;
                if (result1.length > 0) {
                  sql = `UPDATE user_credit SET credits=credits + ${addedCreditAmount} WHERE address='${from.toLowerCase()}'`;
                } else {
                  sql = `INSERT INTO user_credit (address, credits) VALUES ('${from.toLowerCase()}', ${addedCreditAmount})`;
                }
                connection.query(sql, (err, result) => {
                  if (err) throw err;
                  insertLog(address, type, amount, trxHash, addedCreditAmount)
                })
              })
            } else { // sell coins
              address = recipient.toLowerCase();
              type = "sell";
              // let sql = `UPDATE user_credit SET coins=coins - ${addedCreditAmount} WHERE address='${recipient.toLowerCase()}'`;
              
              // connection.query(sql, (err, result) => {
              //   if (err) throw err;
              //   insertLog(address, type, amount, trxHash, addedCreditAmount)
              // })
            }
          }
          const blockNumber = parseInt(resp.data.result[i].blockNumber, 16);
          lastBlock = blockNumber;
        }
      } else {
        await delay(1000);
      }
    } catch (e) {
      console.log(e);
    }
  }
}

const delay = ms => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const insertLog = function (address, type, token_amount, transaction_hash, credits_amount) {
  let sql = `INSERT INTO logs (address, type, token_amount, transaction_hash, credits_amount) 
              VALUES ('${address}', '${type}', ${web3.utils.fromWei(token_amount, "ether")}, '${transaction_hash}', ${credits_amount})`;
  connection.query(sql, (err, result) => {
    if (err) throw err;
  })
}

detectTransactions();
