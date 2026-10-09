/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    props: {
      data: {
        registerAgreement:
          "<p>1. Be kind to other players.</p><p>2. No cheating or griefing.</p><p>3. Follow the staff's instructions.</p>",
      },
    },
  },
  empty: { label: "No agreement text", props: { data: { registerAgreement: "" } } },
};

export const notApplicable = ["loading", "error"];
