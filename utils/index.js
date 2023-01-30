const MTL_EP = "http://43.205.241.105:8080/api/mtl/getAllMoney";
const MAL_EP = "http://43.205.241.105:8080/api/mal/getAllAssetInvestments";

let resData;
let data = [];

const convertToLowerCase = (obj) => {
    return Object.keys(obj).reduce((acc, key) => {
        acc[key.toLowerCase()] = obj[key];
        return acc;
    }, {});
};

const fetchMALData = async () => {
    const responseFromMAL = await fetch(MAL_EP);

    resData = await responseFromMAL.json();

    console.log("resData", resData);
    data = resData.map((data) => {
        return convertToLowerCase(data);
    });

    console.log("TR DA", data);

    return data;
};

const fetchMTLData = async () => {
    // api -> use your employee API
    const responseFromMTL = await fetch(MTL_EP);

    resData = await responseFromMTL.json();

    data = resData.map((data) => {
        return convertToLowerCase(data);
    });

    return data;

    // current = "MAL";
};

export {
    convertToLowerCase, fetchMALData, fetchMTLData, data
}