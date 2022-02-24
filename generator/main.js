const Moralis = require("moralis/node");
const get = require("lodash/get");
const isEmpty = require("lodash/isEmpty");
const fetch = require("node-fetch");

const serverUrl = "https://iyarhobfuh9j.usemoralis.com:2053/server"; //Moralis Server Url here
const appId = "rh6qrB4NGW7JMg0dZrKLpwIyGeVXY3vGPlm54ofV"; //Moralis Server App ID here
Moralis.start({ serverUrl, appId });

const openSeaApiUrl = "https://api.opensea.io/api/v1";
const openSeaApiKey = "2f6f419a083c46de9d83ce3dbe7db601";

const resolveLink = (url) => {
  if (!url || !url.includes("ipfs://")) return url;
  return url.replace("ipfs://", "https://gateway.ipfs.io/ipfs/");
};

const collectionList = [
  "boredapeyachtclub",
  "cool-cats-nft",
  "bored-ape-kennel-club",
];

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

  nftArr.sort((a, b) => b.Rarity - a.Rarity);
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

  const timer = (ms) => new Promise((res) => setTimeout(res, ms));

  for (let i = pageSize; i < totalNum; i = i + pageSize) {
    console.log(ns, "Fetching assets from " + i);
    const NFTs = await Moralis.Web3API.token.getAllTokenIds({
      address: collectionAddress,
      offset: i,
    });
    allNFTs = allNFTs.concat(NFTs.result);
    await timer(3000);
  }

  // Need replace with rarity.py ---------------
  const nftArr = await calculateRarity(allNFTs);
  // -------------------------------------------

  console.log(ns, "Saving result " + nftArr.length);
  for (let i = 0; i < nftArr.length; i++) {
    nftArr[i].Rank = i + 1;
    const newClass = Moralis.Object.extend(collectionName);
    const newObject = new newClass();

    newObject.set("attributes", nftArr[i].Attributes);
    newObject.set("rarity", nftArr[i].Rarity);
    newObject.set("tokenId", nftArr[i].token_id);
    newObject.set("rank", nftArr[i].Rank);
    newObject.set("image", nftArr[i].image);

    await newObject.save();
    console.log(ns, i);
  }
  console.log(ns, "Saved result " + nftArr.length);
  console.log(ns, "Time duration: " + (Date.now() - startTime));

  return true;
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

main();
