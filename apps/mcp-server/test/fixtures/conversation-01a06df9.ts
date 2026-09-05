// Recorded user prompts and first tool arguments, in chronological order.
// Images, generated answers, runtime selection IDs and live prices are not test ground truth.
// Source: codex://threads/01a06df9-d03b-7390-909d-6d8ef716adda
export interface ConversationReplayCase {
  id: string;
  prompt: string;
  sourceTurnId: string;
  attachmentBasename?: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  recordedToolStatus: string;
}

export const CONVERSATION_REPLAY_CASES: ConversationReplayCase[] = [
  {
    "id": "wig-search",
    "prompt": "我要买假发",
    "sourceTurnId": "01a06df9-eee7-7981-8183-f4cd634e69cc",
    "toolCall": {
      "name": "search_products",
      "arguments": {
        "query": "wig",
        "productType": "wig",
        "contextMode": "NEW_PRODUCT",
        "comparisonMode": "DISCOVERY",
        "responseLocale": "zh-CN",
        "selectionMode": "MERCHANT_DIVERSE",
        "limit": 8
      }
    },
    "recordedToolStatus": "completed"
  },
  {
    "id": "wig-delivered-price",
    "prompt": "第一款到手价多少",
    "sourceTurnId": "01a06dfa-d6ab-71c1-bd7c-3c43b5514972",
    "recordedToolStatus": "NO_TOOL_CALL"
  },
  {
    "id": "wig-coupons",
    "prompt": "优惠卷是什么",
    "sourceTurnId": "01a06dfb-7889-7c52-91d4-63da45de872d",
    "toolCall": {
      "name": "research_selected_product_deal",
      "arguments": {
        "renderId": "65a8b11c-ca05-4d65-ad59-6692f69c8892",
        "position": 1,
        "objective": "CURRENT_DEALS"
      }
    },
    "recordedToolStatus": "completed"
  },
  {
    "id": "wig-comparison",
    "prompt": "可以比较我选择的两款吗",
    "sourceTurnId": "01a06dfe-93c7-7500-a61c-2f65d3f09d39",
    "toolCall": {
      "name": "compare_selected_products",
      "arguments": {
        "renderId": "65a8b11c-ca05-4d65-ad59-6692f69c8892",
        "mode": "AUTO",
        "responseLocale": "zh-CN"
      }
    },
    "recordedToolStatus": "completed"
  },
  {
    "id": "shampoo-search",
    "prompt": "我要买洗发水",
    "sourceTurnId": "01a06dff-213c-71c2-b282-fa7758fafa8f",
    "toolCall": {
      "name": "search_products",
      "arguments": {
        "query": "shampoo",
        "productType": "shampoo",
        "contextMode": "NEW_PRODUCT",
        "comparisonMode": "DISCOVERY",
        "responseLocale": "zh-CN",
        "selectionMode": "MERCHANT_DIVERSE",
        "limit": 8
      }
    },
    "recordedToolStatus": "completed"
  },
  {
    "id": "doen-black-dress",
    "prompt": "我要买这件DOEN的裙子",
    "sourceTurnId": "01a06dff-c447-7d13-acb1-b01cb440d04b",
    "attachmentBasename": "codex-clipboard-e1810264-aee5-41b8-a96c-c1ea5213afdb.png",
    "toolCall": {
      "name": "search_visual_candidates",
      "arguments": {
        "query": "DOEN dress",
        "brand": "DOEN",
        "brandMode": "REQUIRED",
        "productType": "dress",
        "contextMode": "NEW_PRODUCT",
        "comparisonMode": "DISCOVERY",
        "allowAlternatives": false,
        "responseLocale": "zh-CN",
        "selectionMode": "MERCHANT_DIVERSE",
        "visualInput": {
          "brand": "DOEN",
          "productType": "dress",
          "imageQuality": "HIGH",
          "observations": [
            {
              "attribute": "COLOR",
              "value": "black",
              "confidence": 0.99,
              "evidence": "Dress body and lace inserts are black."
            },
            {
              "attribute": "NECKLINE",
              "value": "wide boat neckline with lace edging",
              "confidence": 0.95,
              "evidence": "A nearly horizontal neckline sits high on the chest and spreads toward the shoulders."
            },
            {
              "attribute": "SLEEVE",
              "value": "short cap sleeves",
              "confidence": 0.96,
              "evidence": "Small fabric extensions cover the tops of both shoulders; the upper arms are exposed."
            },
            {
              "attribute": "LENGTH",
              "value": "mini, above-knee length",
              "confidence": 0.98,
              "evidence": "The skirt ends at the upper thigh in the visible front view."
            },
            {
              "attribute": "DISTINCTIVE_DETAIL",
              "value": "multiple horizontal sheer floral lace insertion bands alternating with densely gathered opaque panels",
              "confidence": 0.99,
              "evidence": "Lace bands run across the upper chest, bust, waist and skirt."
            },
            {
              "attribute": "SILHOUETTE",
              "value": "fitted gathered bodice with defined waist and flared A-line mini skirt",
              "confidence": 0.98,
              "evidence": "The waist narrows and the skirt flares outward."
            },
            {
              "attribute": "HEM",
              "value": "scalloped lace trim at hem",
              "confidence": 0.93,
              "evidence": "The lower edge has a narrow irregular lace finish."
            }
          ],
          "occlusions": [
            "Hands obscure the center front of the lower bodice and upper skirt.",
            "Back, closure and garment labels are not visible."
          ],
          "softClues": [
            "black lace-insert mini dress",
            "boat neckline",
            "cap sleeves",
            "horizontal gathered panels",
            "fitted waist and flared skirt"
          ]
        }
      }
    },
    "recordedToolStatus": "failed"
  },
  {
    "id": "skims-grey-dress",
    "prompt": "skims",
    "sourceTurnId": "01a06e01-1ad6-7b23-b536-0992abb8f777",
    "attachmentBasename": "codex-clipboard-ca8aa4c8-20e0-48d0-a2b5-d63a48655dc7.png",
    "toolCall": {
      "name": "search_visual_candidates",
      "arguments": {
        "query": "SKIMS dress",
        "brand": "SKIMS",
        "brandMode": "REQUIRED",
        "productType": "dress",
        "contextMode": "NEW_PRODUCT",
        "comparisonMode": "DISCOVERY",
        "responseLocale": "zh-CN",
        "selectionMode": "MERCHANT_DIVERSE",
        "visualInput": {
          "suspectedProductName": "SKIMS Soft Lounge Long Slip Dress",
          "productType": "dress",
          "brand": "SKIMS",
          "colors": [
            "heather gray"
          ],
          "neckline": "wide softly squared scoop neckline",
          "sleeveType": "sleeveless with narrow shoulder straps",
          "silhouette": "fitted bodycon torso and hips with a slightly flared long skirt",
          "length": "long dress; lower hem is outside the image",
          "softClues": [
            "gray heathered fabric",
            "narrow shoulder straps",
            "wide shallow scoop neckline",
            "close-fitting waist and hips",
            "long slightly flared skirt"
          ],
          "occlusions": [
            "Lower hem and feet are outside the image.",
            "Back, closure, and garment labels are not visible.",
            "Dark straps visible behind the gray straps may belong to an undergarment."
          ]
        }
      }
    },
    "recordedToolStatus": "completed"
  },
  {
    "id": "doen-ivory-blouse",
    "prompt": "DOEN",
    "sourceTurnId": "01a06e04-2f8c-7bc3-96d5-0de1fce5981b",
    "attachmentBasename": "codex-clipboard-48a44713-677d-46cc-bbc6-b3e4b0b7df8f.png",
    "toolCall": {
      "name": "search_visual_candidates",
      "arguments": {
        "query": "DOEN blouse",
        "brand": "DOEN",
        "brandMode": "REQUIRED",
        "productType": "blouse",
        "contextMode": "NEW_PRODUCT",
        "comparisonMode": "DISCOVERY",
        "responseLocale": "zh-CN",
        "selectionMode": "MERCHANT_DIVERSE",
        "visualInput": {
          "productType": "blouse",
          "brand": "DOEN",
          "colors": [
            "ivory",
            "cream"
          ],
          "neckline": "deep rounded V neckline bordered with wide floral lace",
          "sleeveType": "short flutter sleeves with lace trim",
          "silhouette": "loose blouse with wide layered ruffles across the chest",
          "length": "waist to high hip length top",
          "distinctiveDetails": [
            "layered cascading ruffle panels across the front and shoulders",
            "narrow center-front tie bow below the neckline",
            "wide floral lace around the neckline",
            "scalloped lace trim on ruffle edges and bottom hem",
            "lightweight semi-sheer fabric"
          ],
          "softClues": [
            "ivory lace-trim ruffled blouse",
            "short flutter sleeves",
            "deep rounded V neckline",
            "center-front bow tie",
            "layered front ruffles"
          ],
          "occlusions": [
            "Raised arm and phone obscure part of the right neckline and shoulder.",
            "Back and garment labels are not visible."
          ]
        }
      }
    },
    "recordedToolStatus": "completed"
  }
];
