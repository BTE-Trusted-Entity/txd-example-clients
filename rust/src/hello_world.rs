use clap::arg;
use codec::Encode;
use subxt::{tx::{TxPayload, PolkadotExtrinsicParams}, ext::{sp_core::{H256, hexdisplay::AsBytesRef, Pair, sr25519}, sp_runtime::{traits::BlakeTwo256, MultiAddress, generic::Header, app_crypto::Ss58Codec}}, SubstrateConfig, Config, OnlineClient};
use blake2::{Blake2b, Digest, digest::consts::U32};

#[subxt::subxt(runtime_metadata_path = "metadata.scale")]
pub mod kilt {}

type Blake2b256 = Blake2b<U32>;

#[derive(serde::Serialize, serde::Deserialize)]
struct JwsHeader {
    kid: String
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct KiltConfig;

impl Config for KiltConfig {
    type Index = u64;
    type BlockNumber = u64;
    type Hash = H256;
    type Hashing = BlakeTwo256;
    type AccountId = <SubstrateConfig as Config>::AccountId;
    type Address = MultiAddress<Self::AccountId, ()>;
    type Header = Header<Self::BlockNumber, BlakeTwo256>;
    type Signature = <SubstrateConfig as Config>::Signature;
    type Extrinsic = <SubstrateConfig as Config>::Extrinsic;
    type ExtrinsicParams = PolkadotExtrinsicParams<Self>;
}

#[tokio::main]
async fn main() -> Result<(), Error>{
    // get command line options
    let matches = clap::Command::new("hello-world")
        .arg(arg!(--seed <VALUE>).required(true))
        .arg(arg!(--txd_endpoint <VALUE>).default_value("https://txd.trusted-entity.io"))
        .arg(arg!(--kilt_endpoint <VALUE>).default_value("wss://spiritnet.kilt.io:443"))
        .get_matches();
    let seed = matches.get_one::<String>("seed").ok_or(Error::DoesntWork)?;
    let txd_endpoint = matches.get_one::<String>("txd_endpoint").ok_or(Error::DoesntWork)?;
    let kilt_endpoint = matches.get_one::<String>("kilt_endpoint").ok_or(Error::DoesntWork)?;

    // build hello-world extrinsic using up to date metadata
    let tx_hex = create_hello_world_tx(kilt_endpoint).await?;
    println!("{}", tx_hex);
    
    // generate DID authentication key
    let auth_key = create_did_auth_key(seed).await?;

    // create submission
    let submission = send_post_request(txd_endpoint, "/api/v1/submission", &tx_hex, &auth_key).await?;
   
    // get submission id from the response
    let tx_id = match submission.get("id") {
        Some(id) => id,
        None => {
            println!("{:#?}", submission);
            return Err(Error::DoesntWork);
        }
    }.as_str().ok_or(Error::DoesntWork)?;

    println!("Successfully submitted transaction with id {}", tx_id);

    // poll status of the submission until its finalized
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;

        let path = format!("/api/v1/submission/{}", tx_id);
        let resp = send_get_request(txd_endpoint, &path, &auth_key).await?;
        let status = match resp.get("status") {
            Some(status) => status,
            None => {
                println!("{:#?}", resp);
                return Err(Error::DoesntWork);
            }
        }.as_str().ok_or(Error::DoesntWork)?;
        println!("Current status: {}", status);
        if status == "Finalized" {
            break;
        }
    }
    Ok(())
}

async fn create_hello_world_tx(kilt_endpoint: &str) -> Result<String, Error> {
    let api = OnlineClient::<KiltConfig>::from_url(&kilt_endpoint).await?;
    let tx = kilt::tx().system().remark("Hello World!".as_bytes().to_vec());
    let mut out = vec![];
    tx.encode_call_data(&api.metadata(), &mut out)?;
    let tx_hex = format!("0x{}",hex::encode(out));
    Ok(tx_hex)
}

async fn create_did_auth_key(seed: &str) -> Result<sr25519::Pair, Error> {
    let auth_key_seed = seed.to_owned() + "//did//0";
    let auth_key = sr25519::Pair::from_string_with_seed(
        &auth_key_seed, 
        None
    ).map_err(|_|Error::DoesntWork)?.0;
    Ok(auth_key)
}

async fn create_key_id(auth_key: &sr25519::Pair) -> Result<String, Error> {
    let mut hasher = Blake2b256::new();
    hasher.update("\x00\x01"); /* PublicVerificationKey || Sr25519 */
    hasher.update(auth_key.public().as_bytes_ref());
    let auth_key_hash = hasher.finalize();
    let kid = format!(
        "did:kilt:{}#0x{}", 
        auth_key.public().to_ss58check_with_version(38u16.into()),
        hex::encode(auth_key_hash)
    );
    Ok(kid)
}

async fn send_post_request(endpoint: &str, path: &str, body: &str, auth_key: &sr25519::Pair) -> Result<serde_json::Value, Error> {
    let kid = create_key_id(auth_key).await?;
    let jws = compute_jws(path, body, &kid, auth_key)?;
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(format!("{}{}",endpoint, path))
        .body(body.to_owned())
        .header("Authorization", format!("Bearer {}", jws))
        .send()
        .await?
        .json()
        .await?;
    Ok(resp)
}

async fn send_get_request(endpoint: &str, path: &str, auth_key: &sr25519::Pair) -> Result<serde_json::Value, Error> {
    let kid = create_key_id(auth_key).await?;
    let jws = compute_jws(path, "", &kid, auth_key)?;
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .get(format!("{}{}",endpoint, path))
        .header("Authorization", format!("Bearer {}", jws))
        .send()
        .await?
        .json()
        .await?;
    Ok(resp)
}

// This computes the authorization token for a given path and payload
fn compute_jws(path: &str, body: &str, kid: &str, pair: &sr25519::Pair) -> Result<String, Error> {
    let mut hasher = Blake2b256::new();
    hasher.update(path.as_bytes());
    hasher.update(body.as_bytes());
    let digest = hasher.finalize();
    let sig = pair.sign(&digest);
    let header = base64_url::encode(&serde_json::to_string(&JwsHeader {
        kid: kid.to_string()
    })?);
    let payload = base64_url::encode(&digest);
    let signature = base64_url::encode(&sig.0);

    Ok(format!("{}.{}.{}", header, payload, signature))
}

#[derive(Debug, Clone, Eq, PartialEq, Encode)]
enum Error {
    DoesntWork
}

impl<T: std::error::Error> From<T> for Error {
    fn from(error: T) -> Self {
        eprintln!("Error: {}", error);
        Self::DoesntWork // :-D
    }
}
