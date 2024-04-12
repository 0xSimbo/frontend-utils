"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CardTitle, CardHeader, CardContent, Card } from "@/components/ui/card";
import { SVGProps, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PiTrashThin } from "react-icons/pi";
import { CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { signmeee } from "@/lib/temp";
import { CopyBlock, dracula } from "react-code-blocks";
import { isAddress } from "ethers/lib/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
const getEthersTypestringFromSolidityType = (type: string): string => {
  //if it starts with uint
  if (type === "uint") return "BigNumber";
  if (type.startsWith("uint")) {
    const bits = type.slice(4);
    const bitsAsNum = parseInt(bits);
    if (bitsAsNum > 128) return "BigNumber";
    return "number";
  }
  if (type === "address") return "`0x${string}`";
  if (type === "uint256") return "BigNumber";
  if (type === "uint8") return "number";
  if (type === "bytes32") return "`0x${string}`";
  if (type === "bool") return "boolean";
  if (type === "string") return "string";
  if (type === "bytes") return "`0x${string}`";
  return "any";
};
const codeSelections = ["ethersV5", "viem"] as const;
type CodeSelection = (typeof codeSelections)[number];

export type ContractConfig = {
  contractName: string;
  version: string;
  chainId: number;
  contractAddress: string;
};
export default function Component({
  defaultTypeHashes,
  defaultContractConfig,
}: {
  defaultTypeHashes: string[] | undefined;
  defaultContractConfig: ContractConfig;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();
  const updateSearchParams = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    replace(`${pathname}?${params.toString()}`);
  };
  const [typeHashes, setTypeHashes] = useState<string[]>(
    defaultTypeHashes || []
  );
  const [code, setCode] = useState<string[]>([]);
  const [contractConfig, setContractConfig] = useState<ContractConfig>(
    defaultContractConfig
  );

  const [codegenType, setCodegenType] = useState<CodeSelection>("ethersV5");

  const setContractConfigNameFromEvent = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setContractConfig((prev) => {
      return { ...prev, contractName: e.target.value };
    });
    updateSearchParams("contractName", e.target.value);
  };
  const setContractConfigVersionFromEvent = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setContractConfig((prev) => {
      return { ...prev, version: e.target.value };
    });
    updateSearchParams("version", e.target.value);
  };
  const setContractConfigChainIdFromEvent = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setContractConfig((prev) => {
      return { ...prev, chainId: parseInt(e.target.value) };
    });
    updateSearchParams("chainId", e.target.value);
  };
  const setContractConfigContractAddressFromEvent = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    //if length is not 42, throw error and sonner
    if (e.target.value.length !== 42) {
      toast.error("Invalid address");
    }
    setContractConfig((prev) => {
      return { ...prev, contractAddress: e.target.value };
    });
    updateSearchParams("contractAddress", e.target.value);
  };

  useEffect(() => {
    const typeHashesString = typeHashes.join("<>");
    updateSearchParams("typeHashes", typeHashesString);
  }, [typeHashes]);

  const getCodeFromTypehashes = () => {
    //If the last one is empty, remove it
    if (typeHashes[typeHashes.length - 1] === "") {
      setTypeHashes((prev) => {
        const newHashes = [...prev];
        newHashes.pop();
        return newHashes;
      });
    }
    //If the contractConfig.contractAddress is not 42, throw error
    if (!isAddress(contractConfig.contractAddress)) {
      toast.error("Invalid contract address");
      return;
    }
    let typescriptTypes: string[] = [];
    let eip712ClassMiddleCodes: string[] = [];

    const keyMap: Map<string, boolean> = new Map(); //TODO: maybe handle more complex cases where same key but different types
    const eip712Types: {
      [key: string]: Array<{ name: string; type: string }>;
    } = {};
    for (const type of typeHashes) {
      const parts = type.split("(");
      const key = parts[0];
      if (keyMap.has(key)) {
        toast.error("Duplicate key `" + key + "`");
        return;
      } else {
        keyMap.set(key, true);
      }
      const typeName = key + "712Schema";
      let typStr = `export type ${typeName} = { \n`;

      const insideElements = parts[1].split(",");
      eip712Types[key] = insideElements.map((element) => {
        const [type, _name] = element.split(" ");
        //if it ends with ) and its the last element, remove the )
        const name = _name.endsWith(")") ? _name.slice(0, -1) : _name;

        typStr += `${name}: ${getEthersTypestringFromSolidityType(type)};\n`;
        return { name, type };
      });
      typStr += "}\n\n";
      const functionStr = `async sign${key}({
        walletOrSigner,
        ${key}}:{
            walletOrSigner: Wallet | Signer | TypedDataSigner;
            ${key}: ${typeName};
        }): Promise<string> {
            const signer = walletOrSigner as unknown as TypedDataSigner;
            const signature = await signer._signTypedData(this.domain,this.types,${key});
            return signature;
        }
        `;
      eip712ClassMiddleCodes.push(functionStr);

      typescriptTypes.push(typStr);
    }

    let importCode = `import {
        BigNumber,
        Wallet,
        Signer,
        TypedDataDomain,
        TypedDataField,
      } from "ethers"; \n
import { TypedDataSigner } from "@ethersproject/abstract-signer";\n\n`;

    let classStartCode = `export class EIP712 {
        public domain: TypedDataDomain;
        public types: Record<string, TypedDataField[]>;
        constructor() {
          this.domain = domain;
          this.types = types;
        }\n\n`;

    //set the code as a string
    const codePart1 = `const types = ${JSON.stringify(eip712Types, null, 2)};`;
    const mockDomain = {
      name: contractConfig.contractName,
      version: contractConfig.version,
      chainId: contractConfig.chainId,
      verifyingContract: contractConfig.contractAddress,
    };
    const codePart2 = `const domain = ${JSON.stringify(mockDomain, null, 2)};\n\n`;
    const _typesCode = typescriptTypes.join("\n\n");
    const classCode =
      classStartCode + eip712ClassMiddleCodes.join("\n\n") + "\n}";
    const _code = [
      importCode,
      _typesCode,
      codePart1,
      "\n\n",
      codePart2,
      classCode,
    ];

    //const viem code =
    //     import { account, walletClient } from './config'
    // import { domain, types } from './data'

    // const signature = await walletClient.signTypedData({
    //   account,
    //   domain,
    //   types,
    //   primaryType: 'Mail',
    //   message: {
    //     from: {
    //       name: 'Cow',
    //       wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    //     },
    //     to: {
    //       name: 'Bob',
    //       wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    //     },
    //     contents: 'Hello, Bob!',
    //   },
    // })
    toast.success("Code generated");
    setCode(_code);
  };

  const processOrThrowTypehash = (type: string): boolean => {
    //make sure it starts with one word that then has a ( after
    // const regex = /^[a-zA-Z0-9_]+\(.*\)$/;
    // if (!regex.test(type)) {
    //   toast.error("Invalid type");
    //   return false;
    // }

    if (type == "") return true;
    if (type.startsWith(`"`)) {
      toast.error("Cannot start with a quote");
      return false;
    }

    //make sure it ends with a )
    const regex = /\(.*\)$/;
    if (!regex.test(type)) {
      toast.error("Must end in a parentheses");
      return false;
    }

    //split it on the (
    const parts = type.split("(");
    //make sure there are no whitespaces in parts[0]
    if (parts[0].includes(" ")) {
      toast.error("First word cannot contain spaces");
      return false;
    }

    //Make sure after each , there is no space
    const secondPart = parts[1];
    if (secondPart.includes(", ")) {
      toast.error("No spaces after commas");
      return false;
    }

    //Make sure there is a max of 1 whitespace per between all second parts
    if (secondPart.includes("  ")) {
      toast.error("No double spaces in between elements");
      return false;
    }

    //Make sure there is exactly one whitespace in all the splits of teh commas in the second parts
    const insideElements = secondPart.split(",");
    for (const element of insideElements) {
      console.log(insideElements);
      //make sure there are exactly two words in the element
      if (element.split(" ").length !== 2) {
        toast.error(`Invalid element ${element}`);
        return false;
      }
    }

    toast.success("Valid type");
    return true;
  };
  function handleFirstTypeChange(
    e: React.ChangeEvent<HTMLInputElement>,
    index?: number
  ) {
    const type = e.target.value;
    const works = processOrThrowTypehash(type);
    //set the 0
    setTypeHashes((prev) => {
      const newHashes = [...prev];
      newHashes[index || 0] = type;
      return newHashes;
    });
  }

  const addEmptyType = () => {
    //if the most recent element is empty, don't add another one
    if (typeHashes[typeHashes.length - 1] === "") {
      toast.error("Fill out the previous type first");
      return;
    }
    setTypeHashes((prev) => {
      return [...prev, ""];
    });
  };

  const removeIndex = (index: number) => {
    setTypeHashes((prev) => {
      const newHashes = [...prev];
      newHashes.splice(index, 1);
      return newHashes;
    });
  };

  return (
    <div className="flex min-h-screen w-full">
      <div className="border-r border-gray-200 bg-gray-100/40 dark:border-gray-800 dark:bg-gray-800/40">
        <div className="flex flex-col gap-2">
          <div className="flex h-[60px] items-center px-6">
            <Link className="flex items-center gap-2 font-semibold" href="#">
              <img className="h-12 w-12 rounded-full" src="/cat.jpg" />
              <span className="">0xSimon Tools</span>
            </Link>
          </div>
          <nav className="grid items-start px-4 text-sm font-medium">
            {/* <Link
              className="flex items-center gap-3 rounded-lg bg-gray-100 px-3 py-2 text-gray-900 transition-all hover:text-gray-900 dark:bg-gray-800 dark:text-gray-50 dark:hover:text-gray-50"
              href="#"
            >
              <HomeIcon className="h-4 w-4" />
              Home
            </Link> */}
            <Link
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50"
              href="#"
            >
              <PackageIcon className="h-4 w-4" />
              EIP712 Code Gen
              {/* <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                6
              </Badge> */}
            </Link>
            <Link
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50"
              href="#"
            >
              <PackageIcon className="h-4 w-4" />
              Jesper Error Checker(Coming Soon)
              {/* <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                6
              </Badge> */}
            </Link>
            {/* <Link
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50"
              href="#"
            >
              <PackageIcon className="h-4 w-4" />
              Products
            </Link> */}
            {/* <Link
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50"
              href="#"
            >
              <UsersIcon className="h-4 w-4" />
              Customers
            </Link> */}
            {/* <Link
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50"
              href="#"
            >
              <LineChartIcon className="h-4 w-4" />
              Analytics
            </Link> */}
          </nav>
        </div>
      </div>
      <div className="flex flex-1 flex-col max-h-screen overflow-y-scroll">
        <div className="mx-auto prose prose-lg max-w-5xl py-8 lg:py-12 flex flex-col gap-y-4">
          <h1 className="text-4xl font-bold">EIP-712 Code Generator</h1>
          <p>
            The Ethereum Improvement Proposal 712, or EIP-712, defines a
            standard way to hash and sign structured data. It provides a
            flexible and secure method for signing messages, which is
            particularly useful for applications such as decentralized finance
            (DeFi), non-fungible tokens (NFTs), and identity verification.
          </p>
          <h2 className="text-xl mt-4">Check and generate your EIP712 Types</h2>
          <Input
            type="text"
            placeholder="Enter type"
            value={typeHashes[0]}
            onChange={handleFirstTypeChange}
          />

          {typeHashes.slice(1).map((type, index) => {
            return (
              <div className="flex gap-2 items-center">
                <Input
                  key={index + 1}
                  type="text"
                  placeholder="Enter type"
                  value={type}
                  onChange={(e) => handleFirstTypeChange(e, index + 1)}
                />
                <PiTrashThin
                  className="h-6 w-6 text-slate-700 hover:text-slate-900 duration-75 cursor-pointer"
                  onClick={() => removeIndex(index + 1)}
                />
              </div>
            );
          })}
          <Button onClick={addEmptyType}>Add Type</Button>
          <p>
            EIP-712 uses a domain separator to define the signing domain for a
            message. This domain includes the contract name, version, and chain
            ID, ensuring that the message is specific to the intended domain.
          </p>
          <Label>Contract Name</Label>
          <Input
            value={contractConfig.contractName}
            onChange={setContractConfigNameFromEvent}
          />
          <Label>Version</Label>
          <Input
            value={contractConfig.version}
            onChange={setContractConfigVersionFromEvent}
          />
          <Label>Chain ID</Label>
          <Input
            value={contractConfig.chainId.toString()}
            onChange={setContractConfigChainIdFromEvent}
          />
          <Label>Contract Address</Label>
          <Input
            value={contractConfig.contractAddress}
            onChange={setContractConfigContractAddressFromEvent}
          />

          <Label>Framework</Label>
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Ethers v5" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Framework</SelectLabel>
                <SelectItem value="ethersV5">Ethers v5</SelectItem>
                <SelectItem disabled value="viem">
                  Viem (Coming Soon)
                </SelectItem>
                {/* <SelectItem value="apple">Apple</SelectItem>
                <SelectItem value="banana">Banana</SelectItem>
                <SelectItem value="blueberry">Blueberry</SelectItem>
                <SelectItem value="grapes">Grapes</SelectItem>
                <SelectItem value="pineapple">Pineapple</SelectItem> */}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button onClick={getCodeFromTypehashes}>Generate Code</Button>

          {code.length > 0 && (
            // <div className="bg-black text-white p-4 flex flex-col gap-y-4 rounded-lg text-xs">
            //   <pre>
            //     {code.map((c) => {
            //       return c;
            //     })}
            //   </pre>
            // </div>

            <div className=" p-4 flex flex-col gap-y-4 rounded-lg text-xs">
              <CopyBlock
                text={code.join("\n")}
                language="typescript"
                showLineNumbers={false}
                wrapLongLines={true}
                theme={dracula}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function CreditCardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  );
}

function DollarSignIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function LineChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

function Package2Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" />
      <path d="M12 3v6" />
    </svg>
  );
}

function PackageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function ShoppingCartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
