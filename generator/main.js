const Moralis = require("moralis/node");
const get = require("lodash/get");
const isEmpty = require("lodash/isEmpty");
const fetch = require("node-fetch");
const fs = require('fs')
const csv = require('csv-parser');
const BPromise = require('bluebird');
const $ = require('lodash');
//const serverUrl = "https://iyarhobfuh9j.usemoralis.com:2053/server"; //Moralis Server Url here
const serverUrl = "https://gls9sd9nxoik.usemoralis.com:2053/server"; //Moralis Server Url here
//const appId = "rh6qrB4NGW7JMg0dZrKLpwIyGeVXY3vGPlm54ofV"; //Moralis Server App ID here
const appId = "ANgKX6UatPQrTJ4jdCpZzdidSjXL3yqSBj1JKUqO"; //Moralis Server App ID here
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

Moralis.start({ serverUrl, appId });

const openSeaApiUrl = "https://api.opensea.io/api/v1";
const openSeaApiKey = "2f6f419a083c46de9d83ce3dbe7db601";

const timer = (ms) => new Promise((res) => setTimeout(res, ms));
const isObject = function(a) {
  return (!!a) && (a.constructor === Object);
}

const resolveLink = (url) => {
  if (!url || !url.includes("ipfs://")) return url;
  return url.replace("ipfs://", "https://gateway.ipfs.io/ipfs/");
};

const collectionList = [
  //"boredapeyachtclub",
  //"clonex",
  //"mutant-ape-yacht-club",
  //"grayboys",
  "degentoonz-collection"
];

  //"cryptopunks" // Nope
async function openSeaApiRequest({
  method = "GET",
  url = "",
  queryParams = {},
} = {}) {
  let requestUrl = `${openSeaApiUrl}/${url}`;

  if (!isEmpty(queryParams)) {
    requestUrl = `${requestUrl}?${new URLSearchParams(queryParams).toString()}`;
  }

  return fetch(requestUrl, {
    method,
    headers: {
      "x-api-key": openSeaApiKey,
      "Content-Type": "application/json",
    },
  }).then((r) => r.json());
}

async function getCollectionDetail(collectionSlug) {
  const data = await openSeaApiRequest({ url: `collection/${collectionSlug}` });

  return {
    collectionName: collectionSlug.split("-").join(""),
    collectionAddress: get(data, [
      "collection",
      "primary_asset_contracts",
      "0",
      "address",
    ]),
    collectionSlug,
  };
}

async function calculateRarity(allNFTs) {
  let metadata = allNFTs.map(
    (e) => get(JSON.parse(e.metadata), "attributes") || []
  );

  const totalNum = allNFTs.length;

  let tally = { TraitCount: {} };

  for (let j = 0; j < metadata.length; j++) {
    let nftTraits = metadata[j].map((e) => e.trait_type);
    let nftValues = metadata[j].map((e) => e.value);

    let numOfTraits = nftTraits.length;

    if (tally.TraitCount[numOfTraits]) {
      tally.TraitCount[numOfTraits]++;
    } else {
      tally.TraitCount[numOfTraits] = 1;
    }

    for (let i = 0; i < nftTraits.length; i++) {
      let current = nftTraits[i];
      if (tally[current]) {
        tally[current].occurences++;
      } else {
        tally[current] = { occurences: 1 };
      }

      let currentValue = nftValues[i];
      if (tally[current][currentValue]) {
        tally[current][currentValue]++;
      } else {
        tally[current][currentValue] = 1;
      }
    }
  }

  const collectionAttributes = Object.keys(tally);
  let nftArr = [];
  for (let j = 0; j < metadata.length; j++) {
    let current = metadata[j];
    let totalRarity = 0;
    for (let i = 0; i < current.length; i++) {
      let rarityScore =
        1 / (tally[current[i].trait_type][current[i].value] / totalNum);
      current[i].rarityScore = rarityScore;
      totalRarity += rarityScore;
    }

    let rarityScoreNumTraits =
      8 * (1 / (tally.TraitCount[Object.keys(current).length] / totalNum));
    current.push({
      trait_type: "TraitCount",
      value: Object.keys(current).length,
      rarityScore: rarityScoreNumTraits,
    });
    totalRarity += rarityScoreNumTraits;

    if (current.length < collectionAttributes.length) {
      let nftAttributes = current.map((e) => e.trait_type);
      let absent = collectionAttributes.filter(
        (e) => !nftAttributes.includes(e)
      );

      absent.forEach((type) => {
        let rarityScoreNull =
          1 / ((totalNum - tally[type].occurences) / totalNum);
        current.push({
          trait_type: type,
          value: null,
          rarityScore: rarityScoreNull,
        });
        totalRarity += rarityScoreNull;
      });
    }

    if (allNFTs[j].metadata) {
      allNFTs[j].metadata = JSON.parse(allNFTs[j].metadata);
      allNFTs[j].image = resolveLink(allNFTs[j].metadata.image);
    } else if (allNFTs[j].token_uri) {
      try {
        await fetch(allNFTs[j].token_uri)
          .then((response) => response.json())
          .then((data) => {
            allNFTs[j].image = resolveLink(data.image);
          });
      } catch (error) {
        console.log(error);
      }
    }

    nftArr.push({
      Attributes: current,
      Rarity: totalRarity,
      token_id: allNFTs[j].token_id,
      image: allNFTs[j].image,
    });
  }

	//console.log('nftArr', JSON.stringify(nftArr, null, 2))
  return nftArr.sort((a, b) => b.Rarity - a.Rarity);
}

async function generateRarity({
  collectionName,
  collectionAddress,
  collectionSlug,
}) {
  const ns = `process-${collectionSlug}`;
  const startTime = Date.now();
  const NFTs = await Moralis.Web3API.token.getAllTokenIds({
    address: collectionAddress,
  });

  const totalNum = NFTs.total;
  const pageSize = NFTs.page_size;
  let allNFTs = NFTs.result;


  for (let i = pageSize; i < totalNum; i = i + pageSize) {
    // console.log(ns, "Fetching assets from " + i);
    const NFTs = await Moralis.Web3API.token.getAllTokenIds({
      address: collectionAddress,
      offset: i,
    });
    allNFTs = allNFTs.concat(NFTs.result);
    await timer(3000);
  }

	console.log(JSON.stringify(allNFTs, null, 2))
  //fs.writeFileSync('test', allNFTs.toString())
  await printCsv(allNFTs)

  return true;
  // Need replace with rarity.py ---------------
  const nftArr = await calculateRarity(allNFTs);
  // -------------------------------------------

	console.log('Result', JSON.stringify(nftArr, null, 2))
  console.log(ns, "Saving result " + nftArr.length);
  
  for (let i = 0; i < nftArr.length; i++) {
    nftArr[i].Rank = i + 1;
    const newClass = Moralis.Object.extend(collectionName);
    const newObject = new newClass();

    newObject.set("attributes", nftArr[i].Attributes);
    newObject.set("rarity", nftArr[i].Rarity);
    newObject.set("tokenId", nftArr[i].token_id);
    newObject.set("rank", Number(nftArr[i].Rank));
    newObject.set("image", nftArr[i].image);

    await newObject.save();
    console.log(ns, i);
  }
  console.log(ns, "Saved result " + nftArr.length);
  console.log(ns, "Time duration: " + (Date.now() - startTime));

  return true;
}

/*
{
  token_address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
  token_id: '9989',
  amount: '1',
  contract_type: 'ERC721',
  name: 'BoredApeYachtClub',
  symbol: 'BAYC',
  token_uri: 'https://ipfs.moralis.io:2053/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/9989',
  metadata: '{"image":"ipfs://QmRixhzz7vuF7Lq1h9XrH8rCyL7kGBZRf3i79ArqDmk7eN","attributes":[{"trait_type":"Clothes","value":"Vietnam Jacket"},{"trait_type":"Hat","value":"Faux Hawk"},{"trait_type":"Mouth","value":"Bored Pizza"},{"trait_type":"Fur","value":"Red"},{"trait_type":"Eyes","value":"Bored"},{"trait_type":"Background","value":"New Punk Blue"}]}\n',
  synced_at: '2021-11-25T11:21:09.140Z'
}
*/

async function printCsv(allNFTs = []) {
  //console.log('allNFTs', allNFTs)
  const collectionName = allNFTs[0].name
  const isCryptoPunks = collectionName === 'CRYPTOPUNKS'
  const allAttributes = allNFTs.reduce((prev, cur) => {
    const newTraits = []
    const meta = JSON.parse(cur.metadata)
    if (!meta) {
      console.log('WARNING', 'metadata is null', cur)
      return [...prev, ...newTraits]
    }

		// CryptoPunk's attributes are different
		// metadata: {attributes: ['Earring', 'Eye patch'], description: 'Male'}
		// => {'trait_type': 'Accessory__Earring', 'value': 'Earring'},
    // {'trait_type': 'Accessory__X attributes', 'value': 'X attributes'}
    // {'trait_type: 'Type', 'value': 'Male'}
    const attributes = meta.attributes
    if (!attributes || !attributes.length) {
      console.log('WARNING', 'attributes is null', cur)
      return [...prev, ...newTraits]
    }

    attributes.forEach((attr) => {
      if (attr) {
        let trait = null
        let xAttributesTrait = null
        
        if (isObject(attr)) {
          trait = attr["trait_type"]
        }
        else {
          trait = `Accessory__${attr}`
          xAttributesTrait = `Accessory__${attributes.length} attributes`
        }
        
        if (trait && !prev.includes(trait)) {
          newTraits.push(trait)
        }
 
        if (isCryptoPunks && xAttributesTrait && !prev.includes(trait)) {
          newTraits.push(xAttributesTrait)
        }
      }
      else if (isCryptoPunks) {
        const noAttributeTrait = 'Accessory__0 attributes'
        if (!prev.includes(noAttributeTrait)) {
          newTraits.push(noAttributeTrait)
        }
      }
      else {
        // For CryptoPunk, use description
        console.log('WARNING', 'attribute null', attributes, cur)
      }
    })

    const description = meta.description || ''

    if (isCryptoPunks && description) {
      if (!prev.includes('Type')) {
        newTraits.push('Type')
      }
    }

    return [...prev, ...newTraits]
  }, [])

  const attributesObj = allAttributes.map((attr) => {
    return {
      id: attr.toLowerCase(),
      title: attr
    }
  })

  const csvWriter = createCsvWriter({
    path: `${collectionName.replace(/ /g, '_')}.csv`,
    header: [
      {id: 'token_id', title: 'TOKEN_ID'},
      {id: 'token_name', title: 'TOKEN_NAME'},
      {id: 'image', title: 'IMAGE'},
      {id: 'token_uri', title: 'TOKEN_URI'},
      ...attributesObj
    ]  
  })

  const data = allNFTs.map((item) => {
    const meta = JSON.parse(item.metadata) || {}
    const attributes = meta.attributes || []
    const result = {
      token_id: item['token_id'],
      token_name: `${item['name']} #${item['token_id']}`,
      image: meta['image'],
      token_uri: item['token_uri']
    }

    const test = attributes.forEach(({trait_type, value}) => {
      if (trait_type) {
        result[trait_type.toLowerCase()] = value
      }
    })

    //console.log('test', result)
    return result
  })

  //console.log('Data', data)
  console.log(`[${collectionName}] All traits`, allAttributes)
  await csvWriter.writeRecords(data)
}

async function writeToDb() {
	const rootDir = `${__dirname}/rarity_data`
  const files = fs.readdirSync(rootDir)

	await BPromise.mapSeries(files, async (file) => {
    if (!file.endsWith('csv')) {
      return
    }
		const data = await new BPromise((resolve, reject) => {
			const result = []	
			fs.createReadStream(`${rootDir}/${file}`)
				.pipe(csv())
				.on('data', (row) => {
					result.push(row)
				})
				.on('end', () => {
					resolve(result)
				})
				.on('error', (error) => {
					reject(error)
				})
		})

		// console.log(data)	
		const collectionName = data[0]['TOKEN_NAME'].split(' ')[0]

		console.log(`Saving result for ${collectionName} with ${data.length} items`)
		//console.log('Data:', JSON.stringify(data, null, 2))
		
		const dbData = await BPromise.mapSeries(data, async (nft) => {
      // console.log(`[${collectionName}] Processing ${nft['TOKEN_ID']}`)
			const result = {
				"Rarity": Number(nft['RARITY_SCORE']),
				"Rank": Number(nft['Rank']),
				"token_id": nft['TOKEN_ID'],
				"image": nft['IMAGE'],
				"Attributes": []
			}

			let attributeFields = $.omit(nft, ['TOKEN_ID', 'TOKEN_NAME', 'IMAGE', 'TOKEN_URI', 'NUM_TRAITS', 'RARITY_SCORE', 'Rank'])

      const tokenUri = $.get(nft, 'TOKEN_URI')
			
			let attributes = []
      /*
			attributeFields = Object.keys(attributeFields)
      try {
        await fetch(resolveLink(tokenUri))
          .then((response) => response.json())
          .then((metadata) => {
          	attributes = metadata.attributes || []
          })
      } catch (error) {
        console.log(error.message, tokenUri)
        // return result
      }

      await timer(3000)
			
			attributes.forEach((attr) => {
        if (attributeFields.includes(attr['trait_type'])) {
			    result.Attributes.push({...attr, rarityScore: nft[attr['trait_type']]})
        } 
      })
      */
     
      //console.log(attributeFields) 
      Object.keys(attributeFields).forEach((key) => {
        result.Attributes.push({
          trait_type: key,
          value: null,
          rarityScore: attributeFields[key]
        })
      })

      return result
		})
		/*
			{
				TOKEN_ID: '17320',
				TOKEN_NAME: 'CloneX #17320',
				IMAGE: 'https://clonex-assets.rtfkt.com/images/17320.png',
				TOKEN_URI: '...',
				// Attributes here
				DNA: '35.16222602739726',
				'Eye Color': '104.61251867952724',
				'Facial Feature': '859.4338727678572',
				Hair: '103.26229508196721',
				Clothing: '178.25295138888887',
				Jewelry: '766.6030363364858',
				Type: '107.48921691792293',
				Mouth: '610.3053298989498',
				Eyewear: '400.23531704781703',
				Accessories: '661.5573453608247',
				Back: '12.708818820966464',
				Helmet: '9.071397017246253',
				NUM_TRAITS: '13392.221739130435',
				RARITY_SCORE: '17240.916064476285',
				Rank: '100'
			}

		{
			"Attributes": [
				{
					"trait_type": "Fur",
					"value": "Black",
					"rarityScore": 8.136696501220504
				},
				{
					"trait_type": "Background",
					"value": "Yellow",
					"rarityScore": 7.79423226812159
				}
			],
			"Rarity": 78.73V542545930553,
			"token_id": "9810",
			"image": "https://gateway.ipfs.io/ipfs/QmPQLBaAdVhixz6LeEy1d4ikVqRwve6R1DCxG8QkJSgygF"
		}
		*/

    //console.log('dbData', JSON.stringify(dbData, null, 2))
    console.log('Saving db for ' + collectionName)
    await BPromise.each(dbData, async (_data) => {
			const newClass = Moralis.Object.extend(collectionName);
			const newObject = new newClass();

			newObject.set("attributes", _data.Attributes);
			newObject.set("rarity", _data.Rarity);
			newObject.set("tokenId", _data.token_id);
			newObject.set("rank", _data.Rank);
			newObject.set("image", _data.image);

			await newObject.save();
    })
    console.log('Done')
	})
}

async function main() {
  let collectionInfoList = [];

  for (let index = 0; index < collectionList.length; index++) {
    const collectionSlug = collectionList[index];

    const collectionDetail = await getCollectionDetail(collectionSlug);
    collectionInfoList.push(collectionDetail);
  }

  console.log("collectionInfoList", collectionInfoList);

  for (let index = 0; index < collectionInfoList.length; index++) {
    const collectionInfo = collectionInfoList[index];
    try {
      await generateRarity(collectionInfo);

      const newClass = Moralis.Object.extend("RarityCalculatedCollections");
      const newObject = new newClass();
      newObject.set("collection", collectionInfo.collectionSlug);
      await newObject.save();
    } catch (error) {
      console.log(
        `Error while processing ${collectionInfo.collectionSlug}...`,
        error
      );
    }
  }
}

//main();
writeToDb();
